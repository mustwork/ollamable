import type {
  Conversation,
  ConversationStep,
  OllamaModel,
  OllamaModelMeta,
  ToolDefinition,
} from "@/src/types/chat";
import { createStep } from "@/src/lib/chat";

const OLLAMA_BASE_URL = "http://localhost:11434/api";

interface TagsResponse {
  models?: Array<{
    name: string;
    modified_at?: string;
    details?: {
      parent_model?: string;
      format?: string;
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

interface StreamChunk {
  done?: boolean;
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      function?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }>;
  };
}

interface ShowResponse {
  license?: string;
  modelfile?: string;
  parameters?: string;
  template?: string;
  system?: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  model_info?: Record<string, string | number | boolean | undefined>;
  capabilities?: string[];
  modified_at?: string;
}

interface PendingMessage {
  role: "user" | "tool";
  content: string;
  toolName?: string;
}

export async function fetchModels(): Promise<OllamaModel[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/tags`);
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  const data = (await response.json()) as TagsResponse;
  return (data.models ?? []).map((model) => ({
    name: model.name,
    family: model.details?.family,
    families: model.details?.families,
    parameterSize: model.details?.parameter_size,
    modifiedAt: model.modified_at,
    parentModel: model.details?.parent_model,
    format: model.details?.format,
    quantizationLevel: model.details?.quantization_level,
  }));
}

export async function fetchModelMeta(model: OllamaModel): Promise<OllamaModelMeta> {
  const response = await fetch(`${OLLAMA_BASE_URL}/show`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.name,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch model metadata: ${response.status}`);
  }

  const data = (await response.json()) as ShowResponse;

  return {
    name: model.name,
    modifiedAt: model.modifiedAt ?? data.modified_at,
    family: data.details?.family ?? model.family,
    families: data.details?.families ?? model.families,
    parentModel: data.details?.parent_model ?? model.parentModel,
    format: data.details?.format ?? model.format,
    parameterSize: data.details?.parameter_size ?? model.parameterSize,
    quantizationLevel: data.details?.quantization_level ?? model.quantizationLevel,
    license: data.license,
    system: data.system,
    template: data.template,
    parameters: data.parameters,
    details: data.details
      ? {
          parent_model: data.details.parent_model,
          format: data.details.format,
          family: data.details.family,
          families: data.details.families,
          parameter_size: data.details.parameter_size,
          quantization_level: data.details.quantization_level,
        }
      : undefined,
    modelInfo: data.model_info,
    capabilities: data.capabilities,
  };
}

export async function streamAssistantResponse(args: {
  conversation: Conversation;
  tools: ToolDefinition[];
  prompt?: string;
  onDelta: (steps: ConversationStep[]) => void;
  signal?: AbortSignal;
}): Promise<ConversationStep[]> {
  const { conversation, prompt, onDelta, signal, tools } = args;
  const response = await fetch(`${OLLAMA_BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOllamaChatBody({ conversation, tools, stream: true, prompt })),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to stream response: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const assistantStep = createStep("assistant", "Assistant", "");
  let reasoningStep: ConversationStep | undefined;
  const toolSteps: ConversationStep[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const result = processStreamLine(line, assistantStep, reasoningStep, toolSteps, onDelta);
      if (result.reasoningStep) {
        reasoningStep = result.reasoningStep;
      }
      if (result.done) {
        return result.steps!;
      }
    }
  }

  // Flush any remaining data in the buffer (handles streams without trailing newline)
  if (buffer.trim()) {
    const result = processStreamLine(buffer, assistantStep, reasoningStep, toolSteps, onDelta);
    if (result.reasoningStep) {
      reasoningStep = result.reasoningStep;
    }
    if (result.done) {
      return result.steps!;
    }
  }

  return compactSteps(reasoningStep, assistantStep, toolSteps);
}

export function buildOllamaChatBody(args: {
  conversation: Conversation;
  tools: ToolDefinition[];
  stream: boolean;
  prompt?: string;
  pendingMessage?: PendingMessage;
}) {
  const { conversation, tools, stream, prompt, pendingMessage } = args;

  return {
    model: conversation.model,
    stream,
    messages: toOllamaMessages(conversation, prompt, pendingMessage),
    tools: tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: parseToolSchema(tool.inputSchema),
      },
    })),
    ...(conversation.temperature != null ? { options: { temperature: conversation.temperature } } : {}),
  };
}

function processStreamLine(
  line: string,
  assistantStep: ConversationStep,
  reasoningStep: ConversationStep | undefined,
  toolSteps: ConversationStep[],
  onDelta: (steps: ConversationStep[]) => void
): { done: boolean; steps?: ConversationStep[]; reasoningStep?: ConversationStep } {
  const trimmed = line.trim();
  if (!trimmed) {
    return { done: false };
  }

  const chunk = JSON.parse(trimmed) as StreamChunk;

  if (chunk.message?.content) {
    assistantStep.content += chunk.message.content;
  }

  if (chunk.message?.thinking) {
    if (!reasoningStep) {
      reasoningStep = createStep("reasoning", "Reasoning", "");
    }
    reasoningStep.content += chunk.message.thinking;
  }

  for (const toolCall of chunk.message?.tool_calls ?? []) {
    const name = toolCall.function?.name ?? "tool_call";
    const nextToolStep = createStep("tool_call", "Tool Call", "", {
      name,
      arguments: toolCall.function?.arguments ?? {},
    });

    const duplicate = toolSteps.some(
      (step) =>
        step.toolCall?.name === nextToolStep.toolCall?.name &&
        JSON.stringify(step.toolCall?.arguments) ===
          JSON.stringify(nextToolStep.toolCall?.arguments)
    );

    if (!duplicate) {
      toolSteps.push(nextToolStep);
    }
  }

  const nextSteps = compactSteps(reasoningStep, assistantStep, toolSteps);
  onDelta(nextSteps);

  if (chunk.done) {
    return { done: true, steps: nextSteps, reasoningStep };
  }

  return { done: false, reasoningStep };
}

function compactSteps(
  reasoningStep: ConversationStep | undefined,
  assistantStep: ConversationStep,
  toolSteps: ConversationStep[]
): ConversationStep[] {
  const visibleAssistantStep = assistantStep.content.trim().length > 0 ? assistantStep : undefined;
  return [reasoningStep, ...toolSteps, visibleAssistantStep].filter(Boolean) as ConversationStep[];
}

function toOllamaMessages(
  conversation: Conversation,
  prompt?: string,
  pendingMessage?: PendingMessage
) {
  const messages: Array<Record<string, unknown>> = [];
  let pendingToolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> =
    [];

  for (const step of conversation.steps) {
    if (step.kind === "system") {
      if (step.content.trim().length > 0) {
        flushPendingToolCalls(messages, pendingToolCalls);
        messages.push({
          role: "system",
          content: step.content,
        });
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
        if (step.kind === "assistant") {
          continue;
        }
      }

      messages.push({
        role: step.kind,
        content: step.content,
      });
      continue;
    }

    if (step.kind === "tool_call" && step.toolCall) {
      pendingToolCalls.push({
        function: {
          name: step.toolCall.name,
          arguments: step.toolCall.arguments,
        },
      });
      continue;
    }

    if (step.kind === "tool_result" && step.toolResult) {
      flushPendingToolCalls(messages, pendingToolCalls);
      pendingToolCalls = [];
      messages.push({
        role: "tool",
        content: step.content,
        tool_name: step.toolResult.name,
      });
    }
  }

  flushPendingToolCalls(messages, pendingToolCalls);

  if (prompt?.trim()) {
    messages.push({ role: "user", content: prompt.trim() });
  }

  if (pendingMessage) {
    messages.push(
      pendingMessage.role === "tool"
        ? {
            role: "tool",
            content: pendingMessage.content,
            tool_name: pendingMessage.toolName ?? "tool",
          }
        : {
            role: "user",
            content: pendingMessage.content,
          }
    );
  }

  return messages;
}

function flushPendingToolCalls(
  messages: Array<Record<string, unknown>>,
  pendingToolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
) {
  if (pendingToolCalls.length === 0) {
    return;
  }

  messages.push({
    role: "assistant",
    content: "",
    tool_calls: pendingToolCalls,
  });
}

function parseToolSchema(inputSchema: string) {
  try {
    const parsed = JSON.parse(inputSchema) as Record<string, unknown>;
    if ("type" in parsed || "properties" in parsed) {
      return parsed;
    }

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
        raw_input: {
          type: "string",
          description: inputSchema,
        },
      },
    };
  }
}
