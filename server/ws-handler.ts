import type WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { ToolDispatcher } from "./tool-executor.js";
import { WebSearchExecutor } from "./tools/web-search.js";
import { McpBridge } from "./tools/mcp-bridge.js";
import { ContextPrepExecutor } from "./tools/context-prep.js";
import { LlmRouter } from "./llm-router.js";
import { loadProviderConfigs } from "./provider-config.js";
import type {
  ClientMessage,
  ConversationStep,
  MetaEvent,
  ServerMessage,
  ToolDefinition,
} from "./types.js";

interface McpConfig {
  mcpServers?: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  >;
}

export class ConnectionHandler {
  private ws: WebSocket;
  private router: LlmRouter;
  private dispatcher: ToolDispatcher;
  private mcpBridge: McpBridge;
  private abortControllers = new Map<string, AbortController>();

  constructor(ws: WebSocket, router?: LlmRouter) {
    this.ws = ws;
    this.router = router ?? new LlmRouter(loadProviderConfigs());
    this.dispatcher = new ToolDispatcher();
    this.mcpBridge = new McpBridge();

    this.dispatcher.register(new WebSearchExecutor());
    this.dispatcher.register(this.mcpBridge);
    this.dispatcher.register(new ContextPrepExecutor());

    ws.on("message", (data) => {
      void this.handleMessage(data.toString());
    });

    ws.on("close", () => {
      for (const controller of this.abortControllers.values()) {
        controller.abort();
      }
      this.abortControllers.clear();
      void this.mcpBridge.disconnect();
    });
  }

  async initMcp(configPath?: string): Promise<ToolDefinition[]> {
    if (!configPath) return [];

    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw) as McpConfig;
      if (!config.mcpServers) return [];

      return this.mcpBridge.connect(config.mcpServers, (event) =>
        this.sendMeta("init", event)
      );
    } catch {
      return [];
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === "ping") {
      this.send({ type: "pong" });
      return;
    }

    if (msg.type === "chat.stop") {
      console.log(`[ws] <- chat.stop  conversation=${msg.conversationId}`);
      const controller = this.abortControllers.get(msg.conversationId);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(msg.conversationId);
      }
      return;
    }

    if (msg.type === "chat.send") {
      const toolNames = (msg.tools ?? []).map((t) => t.name).join(", ");
      console.log(
        `[ws] <- chat.send  conversation=${msg.conversationId}  model=${msg.model}  steps=${msg.steps.length}  tools=[${toolNames}]`
      );
      await this.handleChatSend(msg);
    }
  }

  private async handleChatSend(
    msg: Extract<ClientMessage, { type: "chat.send" }>
  ): Promise<void> {
    const { conversationId, model, provider, tools, temperature } = msg;
    const controller = new AbortController();
    this.abortControllers.set(conversationId, controller);

    // Mutable copy of steps that we extend through the tool loop.
    // `originalCount` marks the boundary so chat.done sends only new steps.
    let steps = [...msg.steps];
    const originalCount = steps.length;

    try {
      // Tool loop: keep calling the LLM until we get a response with no tool calls
      while (true) {
        if (controller.signal.aborted) break;

        const responseSteps = await this.router.streamResponse({
          provider,
          model,
          steps,
          tools,
          temperature,
          signal: controller.signal,
          onDelta: (partialSteps) => {
            this.send({
              type: "chat.delta",
              conversationId,
              steps: partialSteps,
            });
          },
        });

        // Check if any response steps are tool calls that we can execute
        const toolCallSteps = responseSteps.filter(
          (s) => s.kind === "tool_call" && s.toolCall
        );
        const nonToolSteps = responseSteps.filter(
          (s) => s.kind !== "tool_call"
        );

        const executableToolCalls = toolCallSteps.filter(
          (s) => s.toolCall && this.dispatcher.canHandle(s.toolCall.name)
        );

        if (executableToolCalls.length === 0) {
          // No executable tool calls — we're done.
          // Send ALL new steps accumulated during the loop, not just the final response.
          const allNewSteps = [...steps.slice(originalCount), ...responseSteps];
          this.send({
            type: "chat.done",
            conversationId,
            steps: allNewSteps,
          });
          break;
        }

        // Execute tools and build tool result steps
        const toolResultSteps: ConversationStep[] = [];

        for (const toolStep of executableToolCalls) {
          const { name, arguments: toolArgs } = toolStep.toolCall!;

          this.sendMeta(conversationId, {
            id: randomUUID(),
            kind: "mcp_call",
            title: "Tool Dispatch",
            detail: `Executing tool: ${name}`,
            data: { tool: name, arguments: toolArgs },
            timestamp: new Date().toISOString(),
          });

          const result = await this.dispatcher.execute(
            name,
            toolArgs,
            (event) => this.sendMeta(conversationId, event)
          );

          toolResultSteps.push({
            id: randomUUID(),
            kind: "tool_result",
            title: `Result: ${name}`,
            content: result,
            createdAt: new Date().toISOString(),
            expanded: true,
            toolResult: { id: toolStep.toolCall!.id, name },
          });
        }

        // Append tool calls + results to steps and loop back to Ollama
        steps = [
          ...steps,
          ...toolCallSteps,
          ...toolResultSteps,
          // Include any non-tool response steps (assistant text, reasoning)
          ...nonToolSteps,
        ];
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof Error ? error.message : "Unknown server error";
      this.send({ type: "chat.error", conversationId, message });
    } finally {
      this.abortControllers.delete(conversationId);
    }
  }

  private send(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendMeta(conversationId: string, event: MetaEvent): void {
    this.send({ type: "meta.event", conversationId, event });
  }
}
