/**
 * Shared conversion: ConversationStep[] → OpenAI chat-completions request body.
 *
 * Used by the backend to build actual API requests and by the frontend to
 * render a preview of the wire format.
 */

// ── Minimal structural interfaces ────────────────────────────────────
// Both server/types.ts and src/types/chat.ts satisfy these structurally.

export interface FormatStep {
  kind: string;
  content: string;
  toolCall?: { id?: string; name: string; arguments: Record<string, unknown> };
  toolCalls?: { id?: string; name: string; arguments: Record<string, unknown> }[];
  toolResult?: { id?: string; name: string };
}

export interface FormatTool {
  name: string;
  description: string;
  inputSchema: string;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Build a complete OpenAI-compatible `/v1/chat/completions` request body
 * (without transport fields like `stream`).
 */
export function buildOpenAIRequestBody(args: {
  model: string;
  steps: FormatStep[];
  tools: FormatTool[];
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: "disable" | "low" | "medium" | "high";
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: toOpenAIMessages(args.steps),
  };

  if (args.tools.length > 0) {
    body.tools = formatToolsForOpenAI(args.tools);
  }

  if (args.temperature != null) {
    body.temperature = args.temperature;
  }

  if (args.maxOutputTokens != null) {
    body.max_tokens = args.maxOutputTokens;
  }

  if (args.reasoningEffort != null) {
    // OpenAI exposes the lowest reasoning level as "minimal" (gpt-5+); map our
    // "disable" semantic to that so reasoning is suppressed where supported.
    body.reasoning_effort =
      args.reasoningEffort === "disable" ? "minimal" : args.reasoningEffort;
  }

  return body;
}

/**
 * Convert ConversationStep[] into the OpenAI `messages` array format.
 */
export function toOpenAIMessages(steps: FormatStep[]) {
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
      // Flush any legacy separate tool_call steps accumulated before this one
      if (pendingToolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: step.kind === "assistant" ? step.content : "",
          tool_calls: pendingToolCalls,
        });
        pendingToolCalls = [];
        if (step.kind === "assistant") continue;
      }

      // Assistant step with embedded toolCalls array (merged format)
      if (step.kind === "assistant" && step.toolCalls && step.toolCalls.length > 0) {
        const calls = step.toolCalls.map((tc) => {
          const callId = tc.id ?? `call_${generateId()}`;
          if (!tc.id) {
            const queue = generatedIdsByName.get(tc.name) ?? [];
            queue.push(callId);
            generatedIdsByName.set(tc.name, queue);
          }
          return {
            id: callId,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          };
        });
        messages.push({ role: "assistant", content: step.content || "", tool_calls: calls });
        continue;
      }

      messages.push({ role: step.kind, content: step.content });
      continue;
    }

    if (step.kind === "tool_call" && step.toolCall) {
      const callId = step.toolCall.id ?? `call_${generateId()}`;

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
        `call_${generateId()}`;

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

/**
 * Convert tool definitions into the OpenAI `tools` array format.
 */
export function formatToolsForOpenAI(tools: FormatTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: parseToolSchema(tool.inputSchema),
    },
  }));
}

/**
 * Parse a tool's inputSchema string into a JSON Schema object suitable
 * for the OpenAI `parameters` field.
 */
export function parseToolSchema(inputSchema: string): Record<string, unknown> {
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

// ── Private helpers ──────────────────────────────────────────────────

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

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}
