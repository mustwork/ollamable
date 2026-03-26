import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * E2E tests for the WebSocket backend harness features.
 *
 * These tests use Playwright's `page.routeWebSocket` to intercept the
 * browser's WebSocket connection to ws://localhost:3001 and script
 * server messages.  This lets the frontend take the WebSocket code path
 * (wsConnected === true) rather than the direct-Ollama fallback — with
 * no real server process needed.
 *
 * The Ollama /api/chat route is NOT mocked at the browser level so
 * chat only succeeds when it flows through the WebSocket path.
 */

const mockModels = {
  models: [
    {
      name: "qwen3:latest",
      modified_at: "2026-03-20T11:00:00.000Z",
      details: {
        format: "gguf",
        family: "qwen",
        families: ["qwen"],
        parameter_size: "8B",
        quantization_level: "Q4_K_M",
      },
    },
  ],
};

// ── Per-test WebSocket handler ───────────────────────────────────────

type WsHandler = (message: Record<string, unknown>, server: WebSocketRoute) => void;

let wsHandler: WsHandler | null = null;
let wsServer: WebSocketRoute | null = null;

test.beforeEach(async ({ page }) => {
  wsHandler = null;
  wsServer = null;

  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("ollamable.e2e.backend.init")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("ollamable.e2e.backend.init", "1");
    }
  });

  // Model list is still fetched directly by the frontend.
  await page.route("http://localhost:11434/api/tags", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockModels),
    });
  });

  // Intercept WebSocket connection to our mock backend.
  await page.routeWebSocket("ws://localhost:3001", (ws) => {
    wsServer = ws;
    ws.onMessage((raw) => {
      try {
        const data = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        wsHandler?.(data, ws);
      } catch {
        // ignore malformed
      }
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

async function closeToolsDrawer(page: Page) {
  const heading = page.getByRole("heading", { name: "Conversation tools" });
  if (await heading.isVisible()) {
    await page.locator("body").press("Escape");
    await expect(heading).toBeHidden();
  }
}

/** Wait until the WebSocket route has been connected by the browser. */
async function waitForWsConnection() {
  await expect
    .poll(() => wsServer !== null, { timeout: 5_000, message: "waiting for WS route" })
    .toBe(true);
}

function send(ws: WebSocketRoute, msg: Record<string, unknown>) {
  ws.send(JSON.stringify(msg));
}

// ── Tests ────────────────────────────────────────────────────────────

test("streams an assistant response through the WebSocket backend", async ({ page }) => {
  const chatSendReceived = new Promise<void>((resolve) => {
    wsHandler = (data, ws) => {
      if (data.type === "chat.send") {
        const conversationId = data.conversationId as string;

        send(ws, {
          type: "chat.delta",
          conversationId,
          steps: [
            {
              id: "ws-assistant-1",
              kind: "assistant",
              title: "Assistant",
              content: "Hello from the WebSocket backend!",
              createdAt: new Date().toISOString(),
              expanded: true,
            },
          ],
        });

        send(ws, {
          type: "chat.done",
          conversationId,
          steps: [
            {
              id: "ws-assistant-1",
              kind: "assistant",
              title: "Assistant",
              content: "Hello from the WebSocket backend!",
              createdAt: new Date().toISOString(),
              expanded: true,
            },
          ],
        });

        resolve();
      }
    };
  });

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Test backend prompt");
  await page.getByRole("button", { name: "Send" }).click();

  await chatSendReceived;

  await expect(page.getByText("Hello from the WebSocket backend!")).toBeVisible();
  await expect(page.locator('[data-step-kind="assistant"]')).toBeVisible();
});

test("renders reasoning and assistant steps from the backend", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.delta",
        conversationId,
        steps: [
          {
            id: "ws-reasoning-1",
            kind: "reasoning",
            title: "Reasoning",
            content: "Let me think about this carefully...",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Here is my answer via backend.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-reasoning-1",
            kind: "reasoning",
            title: "Reasoning",
            content: "Let me think about this carefully...",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Here is my answer via backend.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Reason for me");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Let me think about this carefully...")).toBeVisible();
  await expect(page.getByText("Here is my answer via backend.")).toBeVisible();
  await expect(page.locator('[data-step-kind="reasoning"]')).toBeVisible();
  await expect(page.locator('[data-step-kind="assistant"]')).toBeVisible();
});

test("renders inline meta event cards from the backend", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      // Emit meta events before the response
      send(ws, {
        type: "meta.event",
        conversationId,
        event: {
          id: "meta-1",
          kind: "search_start",
          title: "Web Search",
          detail: 'Searching for: "test query"',
          data: { query: "test query" },
          timestamp: new Date().toISOString(),
        },
      });

      send(ws, {
        type: "meta.event",
        conversationId,
        event: {
          id: "meta-2",
          kind: "search_result",
          title: "Search Results",
          detail: "Found 3 result(s) in 142ms",
          data: { results: [{ title: "Example", url: "https://example.com", snippet: "A snippet" }], durationMs: 142 },
          timestamp: new Date().toISOString(),
          durationMs: 142,
        },
      });

      // Then send the final assistant response
      send(ws, {
        type: "chat.delta",
        conversationId,
        steps: [
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Search results are in.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Search results are in.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Search something");
  await page.getByRole("button", { name: "Send" }).click();

  // Meta events render as step cards with kind "meta"
  await expect(page.locator('[data-step-kind="meta"]').first()).toBeVisible();
  await expect(page.getByText("Web Search")).toBeVisible();
  await expect(page.getByText("search start")).toBeVisible();

  // The "Server Event Data" section should contain the event payload
  await expect(page.getByText("Server Event Data").first()).toBeVisible();

  // Final response should also be visible
  await expect(page.getByText("Search results are in.")).toBeVisible();
});

test("renders meta events with duration badges", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "meta.event",
        conversationId,
        event: {
          id: "meta-duration-1",
          kind: "mcp_result",
          title: "MCP Result",
          detail: "Tool completed in 350ms",
          data: { tool: "test_tool" },
          timestamp: new Date().toISOString(),
          durationMs: 350,
        },
      });

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Done with MCP call.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("MCP test");
  await page.getByRole("button", { name: "Send" }).click();

  // Duration should be displayed in the secondary text of the meta step
  await expect(page.getByText("mcp result • 350ms")).toBeVisible();
});

test("handles chat.error from the backend and displays an error message", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.error",
        conversationId,
        message: "Ollama request failed: 503",
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Trigger an error");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Failed to stream from backend.")).toBeVisible();
});

test("sends chat.stop when the user clicks stop during streaming", async ({ page }) => {
  let chatStopReceived = false;

  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      // Send a delta but do NOT send chat.done — simulating an ongoing stream
      send(ws, {
        type: "chat.delta",
        conversationId,
        steps: [
          {
            id: "ws-assistant-partial",
            kind: "assistant",
            title: "Assistant",
            content: "Partial response still streaming...",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }

    if (data.type === "chat.stop") {
      chatStopReceived = true;
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Long running request");
  await page.getByRole("button", { name: "Send" }).click();

  // Wait for the partial content to appear (proves the stream started)
  await expect(page.getByText("Partial response still streaming...")).toBeVisible();

  // Click the stop button
  await page.getByRole("button", { name: "Stop" }).click();

  await expect.poll(() => chatStopReceived, { timeout: 3_000 }).toBe(true);
  await expect(page.getByText("Generation stopped.")).toBeVisible();
});

test("forwards the correct model and steps in chat.send", async ({ page }) => {
  let receivedPayload: Record<string, unknown> | null = null;

  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      receivedPayload = data;
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Ack.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  // Set a system prompt
  const systemPrompt = page.getByRole("textbox", { name: "System prompt", exact: true });
  await systemPrompt.fill("You are a test assistant.");

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Verify payload");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Ack.")).toBeVisible();

  expect(receivedPayload).not.toBeNull();
  expect(receivedPayload!.type).toBe("chat.send");
  expect(receivedPayload!.model).toBe("qwen3:latest");
  expect(receivedPayload!.conversationId).toBeTruthy();
  expect(Array.isArray(receivedPayload!.steps)).toBe(true);

  const steps = receivedPayload!.steps as Array<{ kind: string; content: string }>;

  // Should include system prompt and user message
  const systemStep = steps.find((s) => s.kind === "system");
  const userStep = steps.find((s) => s.kind === "user" && s.content === "Verify payload");
  expect(systemStep?.content).toBe("You are a test assistant.");
  expect(userStep).toBeTruthy();
});

test("sends active tool definitions in chat.send when tools are enabled", async ({ page }) => {
  let receivedPayload: Record<string, unknown> | null = null;

  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      receivedPayload = data;
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Tools received.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }
  };

  await page.goto("/");
  await waitForWsConnection();

  // Open tools drawer and enable web_search
  const heading = page.getByRole("heading", { name: "Conversation tools" });
  if (!(await heading.isVisible())) {
    await page.getByRole("button", { name: /Open tools modal/ }).click();
  }
  await expect(heading).toBeVisible();

  const toolCheckbox = page.getByRole("checkbox", {
    name: /web_search/,
  });
  if (!(await toolCheckbox.isChecked())) {
    await toolCheckbox.click();
  }
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Use tools");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Tools received.")).toBeVisible();

  expect(receivedPayload).not.toBeNull();
  const tools = receivedPayload!.tools as Array<{ name: string }>;
  expect(tools.length).toBeGreaterThan(0);
  expect(tools.some((t) => t.name === "web_search")).toBe(true);
});

test("renders tool call and tool result steps from the backend tool loop", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      // Simulate the server tool loop: tool_call → tool_result → final assistant
      send(ws, {
        type: "chat.delta",
        conversationId,
        steps: [
          {
            id: "ws-tool-call-1",
            kind: "tool_call",
            title: "Tool Call",
            content: "Requested web_search",
            createdAt: new Date().toISOString(),
            expanded: true,
            toolCall: {
              name: "web_search",
              arguments: { query: "test query from tool loop" },
            },
          },
        ],
      });

      // After tool execution, send the full result set
      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-tool-call-1",
            kind: "tool_call",
            title: "Tool Call",
            content: "Requested web_search",
            createdAt: new Date().toISOString(),
            expanded: true,
            toolCall: {
              name: "web_search",
              arguments: { query: "test query from tool loop" },
            },
          },
          {
            id: "ws-tool-result-1",
            kind: "tool_result",
            title: "Result: web_search",
            content: '{"query":"test query from tool loop","results":[{"title":"Example","url":"https://example.com"}]}',
            createdAt: new Date().toISOString(),
            expanded: true,
            toolResult: { name: "web_search" },
          },
          {
            id: "ws-assistant-1",
            kind: "assistant",
            title: "Assistant",
            content: "Based on the search results, here is the answer.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Search and answer");
  await page.getByRole("button", { name: "Send" }).click();

  // The final assistant text should be visible
  await expect(page.getByText("Based on the search results, here is the answer.")).toBeVisible();

  // tool_call and tool_result are not in visibleTranscriptSteps, so they
  // should not appear as rendered step cards (they are excluded by isVisibleTranscriptStep).
  await expect(page.locator('[data-step-kind="tool_call"]')).toHaveCount(0);
  await expect(page.locator('[data-step-kind="tool_result"]')).toHaveCount(0);
});

test("persists backend-routed conversation steps across page reload", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-persist-assistant",
            kind: "assistant",
            title: "Assistant",
            content: "This response should persist after reload.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Persistence test");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("This response should persist after reload.")).toBeVisible();

  // Wait for localStorage to be updated
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("ollamable.conversations");
    return raw?.includes("This response should persist after reload.");
  });

  await page.reload();
  await closeToolsDrawer(page);

  await expect(page.getByText("This response should persist after reload.")).toBeVisible();
  await expect(
    page.locator('[data-step-kind="user"] p', { hasText: "Persistence test" })
  ).toBeVisible();
});

test("handles multiple sequential delta messages that build up the response", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      // First delta — partial content
      send(ws, {
        type: "chat.delta",
        conversationId,
        steps: [
          {
            id: "ws-incremental-1",
            kind: "assistant",
            title: "Assistant",
            content: "First chunk. ",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });

      // Second delta — more content (server sends full accumulated text each time)
      setTimeout(() => {
        send(ws, {
          type: "chat.delta",
          conversationId,
          steps: [
            {
              id: "ws-incremental-1",
              kind: "assistant",
              title: "Assistant",
              content: "First chunk. Second chunk. ",
              createdAt: new Date().toISOString(),
              expanded: true,
            },
          ],
        });
      }, 50);

      // Final done
      setTimeout(() => {
        send(ws, {
          type: "chat.done",
          conversationId,
          steps: [
            {
              id: "ws-incremental-1",
              kind: "assistant",
              title: "Assistant",
              content: "First chunk. Second chunk. Final chunk.",
              createdAt: new Date().toISOString(),
              expanded: true,
            },
          ],
        });
      }, 100);
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Stream incrementally");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("First chunk. Second chunk. Final chunk.")).toBeVisible();
});

test("displays input/output tokens and stop reason on assistant steps", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.delta",
        conversationId,
        steps: [
          {
            id: "ws-usage-assistant",
            kind: "assistant",
            title: "Assistant",
            content: "Response with usage stats.",
            createdAt: new Date().toISOString(),
            expanded: true,
          },
        ],
      });

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-usage-assistant",
            kind: "assistant",
            title: "Assistant",
            content: "Response with usage stats.",
            createdAt: new Date().toISOString(),
            expanded: true,
            usage: {
              inputTokens: 42,
              outputTokens: 128,
              stopReason: "stop",
            },
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Show me usage");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Response with usage stats.")).toBeVisible();

  // The secondary text should display token counts and stop reason
  const assistantStep = page.locator('[data-step-kind="assistant"]');
  await expect(assistantStep.getByText("in: 42")).toBeVisible();
  await expect(assistantStep.getByText("out: 128")).toBeVisible();
  await expect(assistantStep.getByText("stop: stop")).toBeVisible();
});

test("displays partial usage data when only some fields are present", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-partial-usage",
            kind: "assistant",
            title: "Assistant",
            content: "Only output tokens.",
            createdAt: new Date().toISOString(),
            expanded: true,
            usage: {
              outputTokens: 55,
            },
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Partial usage");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Only output tokens.")).toBeVisible();

  const assistantStep = page.locator('[data-step-kind="assistant"]');
  await expect(assistantStep.getByText("out: 55")).toBeVisible();
  // Should not show "in:" since inputTokens was not provided
  await expect(assistantStep.getByText(/in:/)).toHaveCount(0);
});

test("persists usage data across page reload", async ({ page }) => {
  wsHandler = (data, ws) => {
    if (data.type === "chat.send") {
      const conversationId = data.conversationId as string;

      send(ws, {
        type: "chat.done",
        conversationId,
        steps: [
          {
            id: "ws-persist-usage",
            kind: "assistant",
            title: "Assistant",
            content: "Persisted usage response.",
            createdAt: new Date().toISOString(),
            expanded: true,
            usage: {
              inputTokens: 100,
              outputTokens: 200,
              stopReason: "length",
            },
          },
        ],
      });
    }
  };

  await page.goto("/");
  await closeToolsDrawer(page);
  await waitForWsConnection();

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Persist usage test");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Persisted usage response.")).toBeVisible();

  // Wait for localStorage persistence
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("ollamable.conversations");
    return raw?.includes('"inputTokens":100');
  });

  await page.reload();
  await closeToolsDrawer(page);

  // Usage data should survive the reload
  const assistantStep = page.locator('[data-step-kind="assistant"]');
  await expect(assistantStep.getByText("in: 100")).toBeVisible();
  await expect(assistantStep.getByText("out: 200")).toBeVisible();
  await expect(assistantStep.getByText("stop: length")).toBeVisible();
});
