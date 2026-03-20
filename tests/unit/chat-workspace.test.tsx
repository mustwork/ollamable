import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeRegistry } from "@/src/components/theme-registry";
import { ChatWorkspace } from "@/src/components/chat-workspace";
import { fetchModelMeta, streamAssistantResponse } from "@/src/lib/ollama";
import { SELECTED_KEY, STORAGE_KEY } from "@/src/lib/chat";

vi.mock("@/src/lib/ollama", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/ollama")>();

  return {
    ...actual,
    fetchModels: vi.fn().mockResolvedValue([
      {
        name: "qwen3:latest",
        family: "qwen",
        families: ["qwen"],
        parameterSize: "8B",
      },
      {
        name: "nomic-embed-text:latest",
        family: "bert",
        families: ["bert"],
        parameterSize: "768D",
      },
    ]),
    fetchModelMeta: vi.fn().mockResolvedValue({
      name: "qwen3:latest",
      family: "qwen",
      families: ["qwen"],
      parameterSize: "8B",
      format: "gguf",
      quantizationLevel: "Q4_K_M",
      capabilities: ["completion"],
      parameters: "temperature 0.7",
      modelInfo: {
        "general.architecture": "qwen3",
      },
    }),
    streamAssistantResponse: vi.fn().mockResolvedValue([
      {
        id: "assistant-1",
        kind: "assistant",
        title: "Assistant",
        content: "Streamed answer",
        createdAt: new Date().toISOString(),
        expanded: true,
      },
    ]),
  };
});

const mockedStreamAssistantResponse = vi.mocked(streamAssistantResponse);
const mockedFetchModelMeta = vi.mocked(fetchModelMeta);
describe("ChatWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedStreamAssistantResponse.mockClear();
    mockedStreamAssistantResponse.mockResolvedValue([
      {
        id: "assistant-1",
        kind: "assistant",
        title: "Assistant",
        content: "Streamed answer",
        createdAt: new Date().toISOString(),
        expanded: true,
      },
    ]);
    mockedFetchModelMeta.mockClear();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  function renderWorkspace() {
    return render(
      <ThemeRegistry>
        <ChatWorkspace />
      </ThemeRegistry>
    );
  }

  it("renders the seeded conversation with the tools modal closed by default", async () => {
    renderWorkspace();

    expect(await screen.findAllByText("New conversation")).not.toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Conversation tools" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open tools modal with 0 active tools" })).toBeInTheDocument();
    expect(screen.getByLabelText("Color mode")).toBeInTheDocument();
  });

  it("allows creating a new conversation", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await screen.findAllByText("New conversation");
    const button = container.querySelector('button[aria-label="New conversation"]');

    expect(button).not.toBeNull();
    await user.click(button!);

    await waitFor(() => {
      expect(screen.getAllByText("New conversation")).not.toHaveLength(0);
    });
  });

  it("filters embedding models out of the selector", async () => {
    renderWorkspace();

    expect(await screen.findAllByText("qwen3:latest")).not.toHaveLength(0);
    expect(screen.queryByText("nomic-embed-text:latest")).not.toBeInTheDocument();
  });

  it("opens a model metadata dialog when clicking the model chip", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText("qwen3:latest");
    await user.click(screen.getByRole("button", { name: "Open metadata for qwen3:latest" }));

    expect(mockedFetchModelMeta).toHaveBeenCalledWith(
      expect.objectContaining({ name: "qwen3:latest" })
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByText("completion")).toBeInTheDocument();
    expect(screen.getByText("temperature 0.7")).toBeInTheDocument();
  });

  it("allows editing the selected conversation title", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText("New conversation");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("heading", { name: "New conversation" }));

    const titleInput = screen.getByRole("textbox", { name: "Conversation name" });
    await user.clear(titleInput);
    await user.type(titleInput, "Renamed conversation");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getAllByText("Renamed conversation")).not.toHaveLength(0);
    });
  });

  it("aborts editing a previous user message", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "conversation-1",
          title: "Editable chat",
          titleEdited: false,
          model: "qwen3:latest",
          systemPrompt: "",
          createdAt: now,
          updatedAt: now,
          steps: [
            {
              id: "system-1",
              kind: "system",
              title: "System Prompt",
              content: "",
              createdAt: now,
              expanded: true,
            },
            {
              id: "user-1",
              kind: "user",
              title: "User",
              content: "Original prompt",
              createdAt: now,
              expanded: true,
            },
            {
              id: "assistant-1",
              kind: "assistant",
              title: "Assistant",
              content: "Original reply",
              createdAt: now,
              expanded: true,
            },
          ],
        },
      ])
    );
    window.localStorage.setItem(SELECTED_KEY, "conversation-1");

    renderWorkspace();

    await screen.findAllByText("Original prompt");
    await user.click(screen.getByRole("button", { name: "Edit message Original prompt" }));

    const editInput = screen.getByRole("textbox", { name: "Edit message" });
    await user.clear(editInput);
    await user.type(editInput, "Changed prompt");
    await user.click(screen.getByRole("button", { name: "Abort" }));

    expect(screen.queryByDisplayValue("Changed prompt")).not.toBeInTheDocument();
    expect(screen.getByText("Original prompt")).toBeInTheDocument();
    expect(screen.getByText("Original reply")).toBeInTheDocument();
  });

  it("edits a previous user message, resends it, and discards the remainder of the conversation", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "conversation-1",
          title: "Original prompt",
          titleEdited: false,
          model: "qwen3:latest",
          systemPrompt: "",
          createdAt: now,
          updatedAt: now,
          steps: [
            {
              id: "system-1",
              kind: "system",
              title: "System Prompt",
              content: "",
              createdAt: now,
              expanded: true,
            },
            {
              id: "user-1",
              kind: "user",
              title: "User",
              content: "Original prompt",
              createdAt: now,
              expanded: true,
            },
            {
              id: "assistant-1",
              kind: "assistant",
              title: "Assistant",
              content: "Old reply",
              createdAt: now,
              expanded: true,
            },
            {
              id: "user-2",
              kind: "user",
              title: "User",
              content: "Later prompt",
              createdAt: now,
              expanded: true,
            },
          ],
        },
      ])
    );
    window.localStorage.setItem(SELECTED_KEY, "conversation-1");

    renderWorkspace();

    await screen.findAllByText("Original prompt");
    await user.click(screen.getByRole("button", { name: "Edit message Original prompt" }));

    const editInput = screen.getByRole("textbox", { name: "Edit message" });
    const editStep = editInput.closest('[data-step-kind="user"]');
    await user.clear(editInput);
    await user.type(editInput, "Edited prompt");
    expect(editStep).not.toBeNull();
    expect(within(editStep!).getByRole("button", { name: "Send" })).toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getAllByText("Edited prompt")).not.toHaveLength(0);
    });

    expect(screen.queryByText("Old reply")).not.toBeInTheDocument();
    expect(screen.queryByText("Later prompt")).not.toBeInTheDocument();
    expect(screen.getAllByText("Edited prompt")).not.toHaveLength(0);
    expect(await screen.findByText("Streamed answer")).toBeInTheDocument();
    expect(mockedStreamAssistantResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({
          steps: expect.arrayContaining([
            expect.objectContaining({
              kind: "user",
              content: "Edited prompt",
            }),
          ]),
        }),
      })
    );

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const storedConversations = JSON.parse(raw!);
    expect(storedConversations[0].steps).toHaveLength(3);
    expect(storedConversations[0].steps[1].content).toBe("Edited prompt");
    expect(storedConversations[0].steps[2].content).toBe("Streamed answer");
  });

  it("regenerates an assistant message and discards the later conversation tail", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "conversation-1",
          title: "Original prompt",
          titleEdited: false,
          model: "qwen3:latest",
          systemPrompt: "",
          createdAt: now,
          updatedAt: now,
          steps: [
            {
              id: "system-1",
              kind: "system",
              title: "System Prompt",
              content: "",
              createdAt: now,
              expanded: true,
            },
            {
              id: "user-1",
              kind: "user",
              title: "User",
              content: "Original prompt",
              createdAt: now,
              expanded: true,
            },
            {
              id: "reasoning-1",
              kind: "reasoning",
              title: "Reasoning",
              content: "Prior reasoning",
              createdAt: now,
              expanded: true,
            },
            {
              id: "assistant-1",
              kind: "assistant",
              title: "Assistant",
              content: "Old reply",
              createdAt: now,
              expanded: true,
            },
            {
              id: "user-2",
              kind: "user",
              title: "User",
              content: "Later prompt",
              createdAt: now,
              expanded: true,
            },
          ],
        },
      ])
    );
    window.localStorage.setItem(SELECTED_KEY, "conversation-1");

    renderWorkspace();

    await screen.findByText("Old reply");
    await user.click(screen.getByRole("button", { name: "Regenerate response Old reply" }));

    await waitFor(() => {
      expect(screen.queryByText("Old reply")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Prior reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("Later prompt")).not.toBeInTheDocument();
    expect(await screen.findByText("Streamed answer")).toBeInTheDocument();
    expect(mockedStreamAssistantResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({
          steps: [
            expect.objectContaining({
              kind: "system",
            }),
            expect.objectContaining({
              kind: "user",
              content: "Original prompt",
            }),
          ],
        }),
      })
    );

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const storedConversations = JSON.parse(raw!);
    expect(storedConversations[0].steps).toHaveLength(3);
    expect(storedConversations[0].steps[1].content).toBe("Original prompt");
    expect(storedConversations[0].steps[2].content).toBe("Streamed answer");
  });

  it("shows a spinner and disables send while waiting for a response", async () => {
    const user = userEvent.setup();
    let resolveStream: ((value: Awaited<ReturnType<typeof streamAssistantResponse>>) => void) | null =
      null;

    mockedStreamAssistantResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        })
    );

    renderWorkspace();

    await screen.findAllByText("New conversation");
    await user.type(screen.getByRole("textbox", { name: "Prompt", exact: true }), "Test prompt");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByLabelText("Waiting for response")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    resolveStream?.([
      {
        id: "assistant-2",
        kind: "assistant",
        title: "Assistant",
        content: "Done",
        createdAt: new Date().toISOString(),
        expanded: true,
      },
    ]);

    await waitFor(() => {
      expect(screen.queryByLabelText("Waiting for response")).not.toBeInTheDocument();
    });
  });

  it("auto-scrolls once when a streamed response starts", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockedStreamAssistantResponse.mockImplementationOnce(async ({ onDelta }) => {
      onDelta?.([
        {
          id: "assistant-1",
          kind: "assistant",
          title: "Assistant",
          content: "Partial",
          createdAt: new Date().toISOString(),
          expanded: true,
        },
      ]);
      onDelta?.([
        {
          id: "assistant-1",
          kind: "assistant",
          title: "Assistant",
          content: "Partial with more text",
          createdAt: new Date().toISOString(),
          expanded: true,
        },
      ]);

      return [
        {
          id: "assistant-1",
          kind: "assistant",
          title: "Assistant",
          content: "Streamed answer",
          createdAt: new Date().toISOString(),
          expanded: true,
        },
      ];
    });

    renderWorkspace();

    await screen.findAllByText("New conversation");
    scrollIntoView.mockClear();
    await user.type(screen.getByRole("textbox", { name: "Prompt", exact: true }), "Scroll test");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });
  });

  it("deletes conversations and removes them from persisted storage", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await screen.findAllByText("New conversation");
    const newConversationButton = container.querySelector(
      'button[aria-label="New conversation"]'
    );

    expect(newConversationButton).not.toBeNull();
    await user.click(newConversationButton!);
    await waitFor(() => {
      expect(screen.getAllByText("New conversation")).toHaveLength(3);
    });

    const deleteButtons = screen.getAllByRole("button", {
      name: /Delete conversation New conversation/,
    });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      const raw = window.localStorage.getItem("ollamable.conversations");
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toHaveLength(1);
    });
  });

  it("opens the tools modal from the conversation header and toggles web search", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText("New conversation");
    await user.click(screen.getByRole("button", { name: "Open tools modal with 0 active tools" }));

    expect(await screen.findByRole("heading", { name: "Conversation tools" })).toBeInTheDocument();

    const checkbox = screen.getByRole("checkbox", { name: /web_search/i });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /web_search/i })).toBeChecked();
    });
  });

  it("shows request JSON with the current prompt content, even when empty", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText("New conversation");
    await user.click(screen.getByRole("button", { name: "Open request JSON preview" }));

    const initialPreview = screen.getByText((_, element) => element?.tagName === "PRE");
    const initialPayload = JSON.parse(initialPreview.textContent ?? "{}");
    expect(initialPayload.messages.at(-1)).toEqual({
      role: "user",
      content: "",
    });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Request JSON" })).not.toBeInTheDocument();
    });
    await user.type(screen.getByRole("textbox", { name: "Prompt", exact: true }), "Draft prompt");
    await user.click(screen.getByRole("button", { name: "Open request JSON preview" }));

    const filledPreview = screen.getByText((_, element) => element?.tagName === "PRE");
    const filledPayload = JSON.parse(filledPreview.textContent ?? "{}");
    expect(filledPayload.messages.at(-1)).toEqual({
      role: "user",
      content: "Draft prompt",
    });
  });

  it("shows a copy action in the request JSON modal", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText("New conversation");
    await user.type(screen.getByRole("textbox", { name: "Prompt", exact: true }), "Draft prompt");
    await user.click(screen.getByRole("button", { name: "Open request JSON preview" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("sends only active tools to Ollama", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText("New conversation");
    await user.click(screen.getByRole("button", { name: "Open tools modal with 0 active tools" }));
    await user.click(screen.getByRole("checkbox", { name: /web_search/i }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Conversation tools" })).not.toBeInTheDocument();
    });
    await user.type(screen.getByRole("textbox", { name: "Prompt", exact: true }), "Need sources");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockedStreamAssistantResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              name: "web_search",
            }),
          ],
        })
      );
    });
  });

  it("shows request JSON with the current tool result content, even when empty", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "conversation-1",
          title: "Tool chat",
          titleEdited: false,
          model: "qwen3:latest",
          systemPrompt: "",
          createdAt: now,
          updatedAt: now,
          availableTools: [
            {
              id: "web-search",
              name: "web_search",
              description: "Searches the web and returns a short source-backed summary.",
              inputSchema: `{
  "query": "string",
  "recency_days": "number?"
}`,
            },
          ],
          activeToolIds: ["web-search"],
          steps: [
            {
              id: "system-1",
              kind: "system",
              title: "System Prompt",
              content: "",
              createdAt: now,
              expanded: true,
            },
            {
              id: "tool-call-1",
              kind: "tool_call",
              title: "Tool Call",
              content: "Requested web_search",
              createdAt: now,
              expanded: true,
              toolCall: {
                name: "web_search",
                arguments: {
                  query: "local ui patterns",
                },
              },
            },
          ],
        },
      ])
    );
    window.localStorage.setItem(SELECTED_KEY, "conversation-1");

    renderWorkspace();

    expect(await screen.findByRole("textbox", { name: "Tool result" })).toBeInTheDocument();
    expect(screen.queryByText("Requested web_search")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open request JSON preview" }));

    const initialPreview = screen.getByText((_, element) => element?.tagName === "PRE");
    const initialPayload = JSON.parse(initialPreview.textContent ?? "{}");
    expect(initialPayload.messages.at(-1)).toEqual({
      role: "tool",
      content: "",
      tool_name: "web_search",
    });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Request JSON" })).not.toBeInTheDocument();
    });
    await user.type(screen.getByRole("textbox", { name: "Tool result" }), "Search summary");
    await user.click(screen.getByRole("button", { name: "Open request JSON preview" }));

    const filledPreview = screen.getByText((_, element) => element?.tagName === "PRE");
    const filledPayload = JSON.parse(filledPreview.textContent ?? "{}");
    expect(filledPayload.messages.at(-1)).toEqual({
      role: "tool",
      content: "Search summary",
      tool_name: "web_search",
    });
  });

  it("replaces the prompt composer with a tool result input when a tool call is pending", async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "conversation-1",
          title: "Tool chat",
          titleEdited: false,
          model: "qwen3:latest",
          systemPrompt: "",
          createdAt: now,
          updatedAt: now,
          availableTools: [
            {
              id: "web-search",
              name: "web_search",
              description: "Searches the web and returns a short source-backed summary.",
              inputSchema: `{
  "query": "string",
  "recency_days": "number?"
}`,
            },
          ],
          activeToolIds: ["web-search"],
          steps: [
            {
              id: "system-1",
              kind: "system",
              title: "System Prompt",
              content: "",
              createdAt: now,
              expanded: true,
            },
            {
              id: "tool-call-1",
              kind: "tool_call",
              title: "Tool Call",
              content: "Requested web_search",
              createdAt: now,
              expanded: true,
              toolCall: {
                name: "web_search",
                arguments: {
                  query: "local ui patterns",
                },
              },
            },
          ],
        },
      ])
    );
    window.localStorage.setItem(SELECTED_KEY, "conversation-1");

    renderWorkspace();

    expect(await screen.findByRole("textbox", { name: "Tool result" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Prompt", exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/Provide the result for web_search/)).toBeInTheDocument();
    expect(screen.queryByText("Requested web_search")).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Tool result" }), "Search summary");
    await user.click(screen.getByRole("button", { name: "Submit result" }));

    await waitFor(() => {
      expect(mockedStreamAssistantResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({
                kind: "tool_result",
                content: "Search summary",
                toolResult: { name: "web_search" },
              }),
            ]),
          }),
        })
      );
    });
  });

  it("validates custom tool schemas as JSON before allowing add", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText("New conversation");
    await user.click(screen.getByRole("button", { name: "Open tools modal with 0 active tools" }));

    await user.type(screen.getByRole("textbox", { name: "Tool name" }), "custom_tool");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Custom description");
    const schemaInput = screen.getByRole("textbox", { name: "Input schema" });
    await user.clear(schemaInput);
    await user.click(schemaInput);
    await user.paste("{invalid");

    expect(screen.getByText("Input schema must be valid JSON.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add tool" })).toBeDisabled();
  });
});
