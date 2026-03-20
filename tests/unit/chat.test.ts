import {
  createConversation,
  formatTimestamp,
  inferTitle,
  loadConversations,
  saveConversations,
} from "@/src/lib/chat";
import { configuredTools } from "@/src/config/tools";

describe("chat helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates a conversation with a seeded system step", () => {
    const conversation = createConversation("qwen3:latest");

    expect(conversation.model).toBe("qwen3:latest");
    expect(conversation.steps).toHaveLength(1);
    expect(conversation.steps[0]?.kind).toBe("system");
    expect(conversation.systemPrompt).toBe("");
  });

  it("infers the title from the first user step", () => {
    const title = inferTitle([
      {
        id: "1",
        kind: "system",
        title: "System Prompt",
        content: "Be concise.",
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        kind: "user",
        title: "User",
        content: "Explain how streaming responses work in Ollama.",
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(title).toBe("Explain how streaming responses work in Ol");
  });

  it("loads a blank conversation when local storage is empty", () => {
    const conversations = loadConversations(configuredTools);

    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.title).toBe("New conversation");
    expect(conversations[0]?.availableTools).toEqual(configuredTools);
    expect(conversations[0]?.activeToolIds).toEqual([]);
    expect(conversations[0]?.steps).toHaveLength(1);
    expect(conversations[0]?.steps[0]?.kind).toBe("system");
  });

  it("round-trips persisted conversations and re-seeds configured tools", () => {
    const conversations = [createConversation("llama3.2:latest", configuredTools)];

    saveConversations(conversations);

    expect(loadConversations(configuredTools)).toEqual(conversations);
  });

  it("formats timestamps into a human-readable label", () => {
    const label = formatTimestamp("2026-03-20T11:00:00.000Z");

    expect(label).toMatch(/Mar/);
  });
});
