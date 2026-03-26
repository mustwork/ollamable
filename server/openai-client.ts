/**
 * OpenAI-compatible API client for providers like MiniMax.
 *
 * Handles the SSE streaming format used by the OpenAI chat completions API
 * and converts responses into the same ConversationStep[] format that the
 * Ollama client produces so the rest of the backend is provider-agnostic.
 *
 * Key differences from Ollama:
 *  - Streaming uses SSE (data: {...}\n\n) instead of NDJSON
 *  - Tool call arguments arrive as incremental string fragments
 *  - Tool calls carry an `id` that must be referenced in tool results
 *  - Temperature is a top-level field, not nested in `options`
 */

import type { ConversationStep, ToolDefinition } from "./types.js";
import type { ProviderConfig } from "./provider-config.js";
import { randomUUID } from "node:crypto";

// ── SSE chunk shape ──────────────────────────────────────────────────

interface SseChunk {
  choices?: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function createStep(
  kind: ConversationStep["kind"],
  title: string,
  content: string,
  toolCall?: ConversationStep["toolCall"]
): ConversationStep {
  return {
    id: randomUUID(),
    kind,
    title,
    content,
    createdAt: new Date().toISOString(),
    expanded: true,
    toolCall,
  };
}

// ── Model listing ────────────────────────────────────────────────────

interface ModelsResponse {
  data: Array<{ id: string; owned_by?: string }>;
}

export async function fetchOpenAIModels(
  config: ProviderConfig
): Promise<Array<{ id: string; ownedBy?: string }>> {
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: {
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch models from ${config.name}: ${response.status}`
    );
  }

  const data = (await response.json()) as ModelsResponse;
  return data.data.map((m) => ({ id: m.id, ownedBy: m.owned_by }));
}

// ── Streaming chat completions ───────────────────────────────────────

export async function streamOpenAIResponse(args: {
  config: ProviderConfig;
  model: string;
  steps: ConversationStep[];
  tools: ToolDefinition[];
  temperature?: number;
  onDelta: (steps: ConversationStep[]) => void;
  signal?: AbortSignal;
}): Promise<ConversationStep[]> {
  const { config, model, steps, tools, temperature, onDelta, signal } = args;

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: toOpenAIMessages(steps),
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: parseToolSchema(tool.inputSchema),
      },
    }));
  }

  if (temperature != null) {
    body.temperature = temperature;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`${config.name} request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const assistantStep = createStep("assistant", "Assistant", "");
  const toolSteps: ConversationStep[] = [];

  // Tool call arguments arrive as incremental string fragments keyed by index.
  const pendingToolCalls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let lastUsage: SseChunk["usage"];
  let finishReason: string | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      processLine(
        line,
        assistantStep,
        toolSteps,
        pendingToolCalls,
        (u) => { lastUsage = u; },
        (r) => { finishReason = r; }
      );

      const current = compactSteps(
        assistantStep,
        materialiseToolSteps(pendingToolCalls, toolSteps)
      );
      onDelta(current);
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      processLine(
        line,
        assistantStep,
        toolSteps,
        pendingToolCalls,
        (u) => { lastUsage = u; },
        (r) => { finishReason = r; }
      );
    }
  }

  // Finalise tool steps with fully accumulated arguments
  const finalToolSteps = materialiseToolSteps(pendingToolCalls, toolSteps);

  if (lastUsage || finishReason) {
    assistantStep.usage = {
      ...(lastUsage?.prompt_tokens != null
        ? { inputTokens: lastUsage.prompt_tokens }
        : {}),
      ...(lastUsage?.completion_tokens != null
        ? { outputTokens: lastUsage.completion_tokens }
        : {}),
      ...(finishReason ? { stopReason: finishReason } : {}),
    };
  }

  return compactSteps(assistantStep, finalToolSteps);
}

// ── SSE line processing ──────────────────────────────────────────────

function processLine(
  raw: string,
  assistantStep: ConversationStep,
  toolSteps: ConversationStep[],
  pendingToolCalls: Map<number, { id: string; name: string; arguments: string }>,
  setUsage: (u: SseChunk["usage"]) => void,
  setFinishReason: (r: string) => void
): void {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) {
    return;
  }

  let chunk: SseChunk;
  try {
    chunk = JSON.parse(trimmed.slice(6)) as SseChunk;
  } catch {
    return;
  }

  const choice = chunk.choices?.[0];
  if (choice) {
    if (choice.delta.content) {
      assistantStep.content += choice.delta.content;
    }

    for (const tc of choice.delta.tool_calls ?? []) {
      let pending = pendingToolCalls.get(tc.index);
      if (!pending) {
        pending = { id: tc.id ?? randomUUID(), name: "", arguments: "" };
        pendingToolCalls.set(tc.index, pending);
      }
      if (tc.id) pending.id = tc.id;
      if (tc.function?.name) pending.name += tc.function.name;
      if (tc.function?.arguments) pending.arguments += tc.function.arguments;
    }

    if (choice.finish_reason) {
      setFinishReason(choice.finish_reason);
    }
  }

  if (chunk.usage) {
    setUsage(chunk.usage);
  }
}

// ── Tool step materialisation ────────────────────────────────────────

/**
 * Convert accumulated pending tool call data into ConversationStep objects.
 * Already-materialised steps (from earlier delta cycles) are updated in place
 * with the latest accumulated arguments.
 */
function materialiseToolSteps(
  pendingToolCalls: Map<number, { id: string; name: string; arguments: string }>,
  existing: ConversationStep[]
): ConversationStep[] {
  const result = [...existing];

  for (const [index, tc] of pendingToolCalls) {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      // Arguments may still be incomplete during streaming
    }

    if (index < result.length && result[index]?.toolCall) {
      // Update existing step with latest data
      result[index].toolCall!.arguments = parsedArgs;
    } else if (index >= result.length) {
      result.push(
        createStep("tool_call", "Tool Call", "", {
          id: tc.id,
          name: tc.name || "tool_call",
          arguments: parsedArgs,
        })
      );
    }
  }

  return result;
}

// ── Step compaction ──────────────────────────────────────────────────

function compactSteps(
  assistantStep: ConversationStep,
  toolSteps: ConversationStep[]
): ConversationStep[] {
  const visible =
    assistantStep.content.trim().length > 0 ? assistantStep : undefined;
  return [...toolSteps, visible].filter(Boolean) as ConversationStep[];
}

// ── Message conversion (ConversationStep[] → OpenAI messages) ────────

function toOpenAIMessages(steps: ConversationStep[]) {
  const messages: Array<Record<string, unknown>> = [];
  let pendingToolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }> = [];

  // Track generated IDs so tool_result steps without persisted IDs can be
  // matched to their corresponding tool_call by name (in order).
  const generatedIdsByName = new Map<string, string[]>();

  for (const step of steps) {
    if (step.kind === "meta" || step.kind === "reasoning") continue;

    if (step.kind === "system") {
      if (step.content.trim().length > 0) {
        flushToolCalls(messages, pendingToolCalls);
        pendingToolCalls = [];
        messages.push({ role: "system", content: step.content });
      }
      continue;
    }

    if (step.kind === "user" || step.kind === "assistant") {
      if (pendingToolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: step.kind === "assistant" ? step.content : "",
          tool_calls: pendingToolCalls,
        });
        pendingToolCalls = [];
        if (step.kind === "assistant") continue;
      }
      messages.push({ role: step.kind, content: step.content });
      continue;
    }

    if (step.kind === "tool_call" && step.toolCall) {
      const callId = step.toolCall.id ?? `call_${randomUUID().slice(0, 8)}`;

      // Remember the generated ID so the matching tool_result can reuse it
      if (!step.toolCall.id) {
        const queue = generatedIdsByName.get(step.toolCall.name) ?? [];
        queue.push(callId);
        generatedIdsByName.set(step.toolCall.name, queue);
      }

      pendingToolCalls.push({
        id: callId,
        type: "function",
        function: {
          name: step.toolCall.name,
          arguments: JSON.stringify(step.toolCall.arguments),
        },
      });
      continue;
    }

    if (step.kind === "tool_result" && step.toolResult) {
      flushToolCalls(messages, pendingToolCalls);
      pendingToolCalls = [];

      // Use the persisted ID, or fall back to the ID generated for the
      // matching tool_call with the same name (consumed in order).
      const resultId =
        step.toolResult.id ??
        generatedIdsByName.get(step.toolResult.name)?.shift() ??
        `call_${randomUUID().slice(0, 8)}`;

      messages.push({
        role: "tool",
        tool_call_id: resultId,
        content: step.content,
      });
    }
  }

  flushToolCalls(messages, pendingToolCalls);
  return messages;
}

function flushToolCalls(
  messages: Array<Record<string, unknown>>,
  pending: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>
) {
  if (pending.length === 0) return;
  messages.push({ role: "assistant", content: "", tool_calls: pending });
}

// ── Tool schema parsing (shared logic with ollama-client) ────────────

function parseToolSchema(inputSchema: string) {
  try {
    const parsed = JSON.parse(inputSchema) as Record<string, unknown>;
    if ("type" in parsed || "properties" in parsed) return parsed;

    const properties = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => {
        const rawType = typeof value === "string" ? value : "string";
        const normalizedType = rawType.replace("?", "").trim().toLowerCase();
        return [
          key,
          {
            type:
              normalizedType === "number" || normalizedType === "integer"
                ? "number"
                : normalizedType === "boolean"
                  ? "boolean"
                  : "string",
          },
        ];
      })
    );

    const required = Object.entries(parsed)
      .filter(([, value]) => typeof value === "string" && !value.includes("?"))
      .map(([key]) => key);

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  } catch {
    return {
      type: "object",
      properties: {
        raw_input: { type: "string", description: inputSchema },
      },
    };
  }
}
