import type {
  ConversationStep,
  MetaEventPayload,
  ReasoningEffort,
  ToolDefinition,
} from "@/src/types/chat";

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  return "ws://localhost:3000";
}

export const WS_URL = getWsUrl();

interface ServerMessage {
  type: string;
  conversationId?: string;
  steps?: ConversationStep[];
  message?: string;
  event?: {
    id: string;
    kind: string;
    title: string;
    detail: string;
    data?: Record<string, unknown>;
    timestamp: string;
    durationMs?: number;
  };
}

interface StreamRequest {
  conversationId: string;
  model: string;
  provider?: string;
  steps: ConversationStep[];
  tools: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  onDelta: (steps: ConversationStep[]) => void;
  onStableSteps: (steps: ConversationStep[]) => void;
  onMetaEvent: (step: ConversationStep) => void;
}

interface PendingStream {
  request: StreamRequest;
  resolve: (steps: ConversationStep[]) => void;
  reject: (error: Error) => void;
}

export class BackendClient {
  private pending = new Map<string, PendingStream>();

  handleServerMessage(raw: unknown): void {
    const msg = raw as ServerMessage;
    if (!msg.type || !msg.conversationId) return;

    const stream = this.pending.get(msg.conversationId);
    if (!stream) return;

    if (msg.type === "chat.delta" && msg.steps) {
      stream.request.onDelta(msg.steps);
    }

    if (msg.type === "chat.steps" && msg.steps) {
      stream.request.onStableSteps(msg.steps);
    }

    if (msg.type === "chat.done" && msg.steps) {
      this.pending.delete(msg.conversationId);
      stream.resolve(msg.steps);
    }

    if (msg.type === "chat.error") {
      this.pending.delete(msg.conversationId);
      stream.reject(new Error(msg.message ?? "Server error"));
    }

    if (msg.type === "meta.event" && msg.event) {
      const metaStep: ConversationStep = {
        id: `meta-${msg.event.id}`,
        kind: "meta",
        title: msg.event.title,
        content: msg.event.detail,
        createdAt: msg.event.timestamp,
        expanded: true,
        metaEvent: {
          kind: msg.event.kind as MetaEventPayload["kind"],
          title: msg.event.title,
          detail: msg.event.detail,
          data: msg.event.data,
          durationMs: msg.event.durationMs,
        },
      };
      stream.request.onMetaEvent(metaStep);
    }
  }

  startStream(
    send: (data: unknown) => void,
    request: StreamRequest
  ): { promise: Promise<ConversationStep[]>; stop: () => void } {
    const { conversationId, model, provider, steps, tools, temperature, maxOutputTokens, reasoningEffort } = request;

    const promise = new Promise<ConversationStep[]>((resolve, reject) => {
      this.pending.set(conversationId, { request, resolve, reject });
    });

    send({
      type: "chat.send",
      conversationId,
      model,
      provider,
      steps,
      tools,
      temperature,
      maxOutputTokens,
      reasoningEffort,
    });

    const stop = () => {
      send({ type: "chat.stop", conversationId });
      const stream = this.pending.get(conversationId);
      if (stream) {
        this.pending.delete(conversationId);
        stream.reject(new Error("AbortError"));
      }
    };

    return { promise, stop };
  }

  cancelAll(): void {
    for (const [id, stream] of this.pending) {
      stream.reject(new Error("AbortError"));
      this.pending.delete(id);
    }
  }
}
