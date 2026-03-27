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
import { toOpenAIMessages, parseToolSchema } from "../shared/openai-format.js";

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
  maxOutputTokens?: number;
  onDelta: (steps: ConversationStep[]) => void;
  signal?: AbortSignal;
}): Promise<ConversationStep[]> {
  const { config, model, steps, tools, temperature, maxOutputTokens, onDelta, signal } = args;

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

  if (maxOutputTokens != null) {
    body.max_tokens = maxOutputTokens;
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

  const reasoningStep = createStep("reasoning", "Reasoning", "");
  const assistantStep = createStep("assistant", "Assistant", "");
  const toolSteps: ConversationStep[] = [];

  // Tool call arguments arrive as incremental string fragments keyed by index.
  const pendingToolCalls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let lastUsage: SseChunk["usage"];
  let finishReason: string | undefined;

  // Tracks whether we're inside a <think>…</think> region so content
  // arriving across multiple SSE chunks is routed to the reasoning step.
  const thinkState = { inside: false };

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
        reasoningStep,
        thinkState,
        toolSteps,
        pendingToolCalls,
        (u) => { lastUsage = u; },
        (r) => { finishReason = r; }
      );

      const current = compactSteps(
        reasoningStep,
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
        reasoningStep,
        thinkState,
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

  return compactSteps(reasoningStep, assistantStep, finalToolSteps);
}

// ── SSE line processing ──────────────────────────────────────────────

/**
 * Route a content fragment to the reasoning or assistant step depending on
 * whether we are inside a `<think>…</think>` region.  Handles fragments that
 * contain the opening tag, the closing tag, both, or neither.
 */
function routeContent(
  fragment: string,
  assistantStep: ConversationStep,
  reasoningStep: ConversationStep,
  thinkState: { inside: boolean }
): void {
  let remaining = fragment;

  while (remaining.length > 0) {
    if (thinkState.inside) {
      const closeIdx = remaining.indexOf("</think>");
      if (closeIdx === -1) {
        // Still inside thinking — all remaining goes to reasoning
        reasoningStep.content += remaining;
        return;
      }
      // Consume up to (and including) the closing tag
      reasoningStep.content += remaining.slice(0, closeIdx);
      remaining = remaining.slice(closeIdx + "</think>".length);
      thinkState.inside = false;
    } else {
      const openIdx = remaining.indexOf("<think>");
      if (openIdx === -1) {
        // Not inside thinking — all remaining goes to assistant
        assistantStep.content += remaining;
        return;
      }
      // Text before the tag goes to assistant
      assistantStep.content += remaining.slice(0, openIdx);
      remaining = remaining.slice(openIdx + "<think>".length);
      thinkState.inside = true;
    }
  }
}

function processLine(
  raw: string,
  assistantStep: ConversationStep,
  reasoningStep: ConversationStep,
  thinkState: { inside: boolean },
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
      routeContent(choice.delta.content, assistantStep, reasoningStep, thinkState);
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
  reasoningStep: ConversationStep,
  assistantStep: ConversationStep,
  toolSteps: ConversationStep[]
): ConversationStep[] {
  const reasoning =
    reasoningStep.content.trim().length > 0 ? reasoningStep : undefined;
  const visible =
    assistantStep.content.trim().length > 0 ? assistantStep : undefined;
  return [reasoning, ...toolSteps, visible].filter(Boolean) as ConversationStep[];
}

// toOpenAIMessages, parseToolSchema — imported from ../shared/openai-format.js
