import { expect, test, type Page } from "@playwright/test";

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
    {
      name: "llama3.2:latest",
      modified_at: "2026-03-20T10:00:00.000Z",
      details: {
        format: "gguf",
        family: "llama",
        families: ["llama"],
        parameter_size: "3B",
        quantization_level: "Q4_K_M",
      },
    },
    {
      name: "nomic-embed-text:latest",
      modified_at: "2026-03-20T09:00:00.000Z",
      details: {
        format: "gguf",
        family: "bert",
        families: ["bert"],
        parameter_size: "768D",
        quantization_level: "F16",
      },
    },
  ],
};

const streamedChatBody = [
  JSON.stringify({
    message: {
      thinking: "I should show my reasoning as a separate step.",
      tool_calls: [
        {
          function: {
            name: "web_search",
            arguments: {
              query: "best local ollama ui patterns",
            },
          },
        },
      ],
    },
    done: false,
  }),
  JSON.stringify({
    message: {
      content: "This is a streamed answer from the mocked Ollama endpoint.",
    },
    done: false,
  }),
  JSON.stringify({
    message: {
      content: " It includes final assistant text.",
    },
    done: true,
  }),
].join("\n");

async function closeToolsDrawer(page: Page) {
  const heading = page.getByRole("heading", { name: "Conversation tools" });
  if (await heading.isVisible()) {
    await page.locator("body").press("Escape");
    await expect(heading).toBeHidden();
  }
}

async function seedConversationState(
  page: Page,
  conversations: unknown,
  selectedConversationId: string
) {
  await page.addInitScript(
    ({ nextConversations, nextSelectedConversationId }) => {
      window.localStorage.setItem(
        "ollamable.conversations",
        JSON.stringify(nextConversations)
      );
      window.localStorage.setItem(
        "ollamable.selectedConversationId",
        nextSelectedConversationId
      );
    },
    {
      nextConversations: conversations,
      nextSelectedConversationId: selectedConversationId,
    }
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("ollamable.e2e.init")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("ollamable.e2e.init", "1");
    }
  });

  await page.route("http://localhost:11434/api/tags", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockModels),
    });
  });

  await page.route("http://localhost:11434/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: streamedChatBody,
    });
  });
});

test("loads the shell with a blank conversation and header model selector", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await expect(page.getByText("Ollamable").first()).toBeVisible();
  await expect(page.getByText("New conversation").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Model" })).toHaveText("qwen3:latest");
  await expect(page.getByRole("textbox", { name: "System prompt", exact: true })).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Reasoning trace demo" })).toHaveCount(0);
});

test("creates and selects a new conversation from the sidebar", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page.locator('button[aria-label="New conversation"]').click();

  await expect(page.getByText("New conversation").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "System prompt", exact: true })).toHaveValue("");
});

test("edits the system prompt inline before the conversation starts", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  const systemPrompt = page.getByRole("textbox", { name: "System prompt", exact: true });
  await systemPrompt.fill("You are a rigorous local UI test assistant.");
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("ollamable.conversations");
    return raw?.includes("You are a rigorous local UI test assistant.");
  });
  await expect(
    page.getByRole("textbox", { name: "System prompt", exact: true })
  ).toHaveValue("You are a rigorous local UI test assistant.");
  await expect(
    page.getByText("Editable until the first message is sent.")
  ).toBeVisible();
});

test("locks the system prompt after the conversation starts", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  const systemPrompt = page.getByRole("textbox", { name: "System prompt", exact: true });
  await systemPrompt.fill("Lock this prompt after start.");

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Start the conversation.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(systemPrompt).toBeDisabled();
  await expect(page.getByText("Locked after the conversation starts.")).toBeVisible();
  await expect(systemPrompt).toHaveValue("Lock this prompt after start.");
  await expect(
    page.locator('[data-step-kind="user"] p', { hasText: "Start the conversation." })
  ).toBeVisible();
});

test("supports model selection from the mocked Ollama tag list", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page.getByRole("combobox", { name: "Model" }).click();
  await expect(
    page.getByRole("option", { name: "nomic-embed-text:latest" })
  ).toHaveCount(0);
  await page.getByRole("option", { name: "llama3.2:latest" }).click();

  await expect(page.getByText("llama3.2:latest").first()).toBeVisible();
});

test("renders distinct background colors for visible transcript roles", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Show me a mocked streamed answer with reasoning and tool calls.");
  await page.getByRole("button", { name: "Send" }).click();

  const userBackground = await page
    .locator('[data-step-kind="user"]')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const assistantBackground = await page
    .locator('[data-step-kind="assistant"]')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const reasoningBackground = await page
    .locator('[data-step-kind="reasoning"]')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(userBackground).not.toBe(assistantBackground);
  expect(userBackground).not.toBe(reasoningBackground);
  expect(reasoningBackground).not.toBe(assistantBackground);
});

test("collapses and expands conversation steps", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Collapse this user message.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.locator('[data-step-kind="user"] p', { hasText: "Collapse this user message." })
  ).toBeVisible();

  await page.locator('[data-step-kind="user"] [role="button"]').first().click();

  await expect(
    page.locator('[data-step-kind="user"] p', { hasText: "Collapse this user message." })
  ).toBeHidden();

  await page.locator('[data-step-kind="user"] [role="button"]').first().click();

  await expect(
    page.locator('[data-step-kind="user"] p', { hasText: "Collapse this user message." })
  ).toBeVisible();
});

test("clicking the pencil expands a collapsed user step for editing", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Edit this collapsed message.");
  await page.getByRole("button", { name: "Send" }).click();

  const userStep = page.locator('[data-step-kind="user"]').first();
  await userStep.getByRole("button").first().click();

  await expect(
    page.locator('[data-step-kind="user"] p', { hasText: "Edit this collapsed message." })
  ).toBeHidden();

  await userStep.getByRole("button", { name: "Edit message Edit this collapsed message." }).click();

  await expect(page.getByRole("textbox", { name: "Edit message" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abort" })).toBeVisible();
});

test("submits an edited previous user message and replaces the later conversation tail", async ({
  page,
}) => {
  const now = "2026-03-20T11:00:00.000Z";
  await seedConversationState(
    page,
    [
      {
        id: "conversation-1",
        title: "Original prompt",
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
        activeToolIds: [],
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
    ],
    "conversation-1"
  );

  await page.goto("/");
  await closeToolsDrawer(page);

  await page.getByRole("button", { name: "Edit message Original prompt" }).click();

  const editedStep = page.locator('[data-step-kind="user"]').first();
  const editInput = page.getByRole("textbox", { name: "Edit message" });
  await editInput.fill("Edited prompt");
  await expect(editedStep.getByRole("button", { name: "Send" })).toBeVisible();
  await editInput.press("Enter");

  await expect(page.locator('[data-step-kind="user"] p', { hasText: "Edited prompt" })).toBeVisible();
  await expect(page.getByText("Old reply")).toHaveCount(0);
  await expect(page.getByText("Later prompt")).toHaveCount(0);
  await expect(page.getByText("This is a streamed answer from the mocked Ollama endpoint.")).toBeVisible();
});

test("regenerates an assistant response and replaces the later conversation tail", async ({
  page,
}) => {
  const now = "2026-03-20T11:00:00.000Z";
  await seedConversationState(
    page,
    [
      {
        id: "conversation-1",
        title: "Original prompt",
        titleEdited: false,
        model: "qwen3:latest",
        systemPrompt: "",
        createdAt: now,
        updatedAt: now,
        availableTools: [],
        activeToolIds: [],
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
    ],
    "conversation-1"
  );

  await page.goto("/");
  await closeToolsDrawer(page);

  await page.getByRole("button", { name: "Regenerate response Old reply" }).click();

  await expect(page.getByText("Old reply")).toHaveCount(0);
  await expect(page.getByText("Prior reasoning")).toHaveCount(0);
  await expect(page.getByText("Later prompt")).toHaveCount(0);
  await expect(page.getByText("This is a streamed answer from the mocked Ollama endpoint.")).toBeVisible();
});

test("regenerates a newly created assistant response and replaces it with a fresh response", async ({
  page,
}) => {
  const responses = [
    [
      JSON.stringify({
        message: {
          thinking: "First reasoning trace.",
        },
        done: false,
      }),
      JSON.stringify({
        message: {
          content: "First generated answer.",
        },
        done: true,
      }),
    ].join("\n"),
    [
      JSON.stringify({
        message: {
          thinking: "Second reasoning trace.",
        },
        done: false,
      }),
      JSON.stringify({
        message: {
          content: "Second generated answer.",
        },
        done: true,
      }),
    ].join("\n"),
  ];
  let chatCallCount = 0;

  await page.unroute("http://localhost:11434/api/chat");
  await page.route("http://localhost:11434/api/chat", async (route) => {
    const body = responses[Math.min(chatCallCount, responses.length - 1)];
    chatCallCount += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body,
    });
  });

  await page.goto("/");
  await closeToolsDrawer(page);

  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Regenerate this answer.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("First reasoning trace.")).toBeVisible();
  await expect(page.getByText("First generated answer.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Regenerate response First generated answer." })).toBeVisible();
  await expect.poll(() => chatCallCount).toBe(1);

  await page.getByRole("button", { name: "Regenerate response First generated answer." }).click();

  await expect(page.getByText("First reasoning trace.")).toHaveCount(0);
  await expect(page.getByText("First generated answer.")).toHaveCount(0);
  await expect(page.getByText("Second reasoning trace.")).toBeVisible();
  await expect(page.getByText("Second generated answer.")).toBeVisible();
  await expect.poll(() => chatCallCount).toBe(2);
});

test("lets the user close and reopen the tools modal with tool definitions visible", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Conversation tools" })).toBeHidden();

  await page.getByRole("button", { name: "Open tools modal with 0 active tools" }).click();
  await expect(page.getByRole("heading", { name: "Conversation tools" })).toBeVisible();
  await expect(page.getByText("web_search")).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "web_search Searches the web and returns a short source-backed summary.",
    })
  ).toBeVisible();
  await expect(page.getByText('{ "query": "string", "recency_days": "number?" }')).toBeVisible();

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Conversation tools" })).toBeHidden();

  await page.getByRole("button", { name: "Open tools modal with 0 active tools" }).click();
  await expect(page.getByText("web_search")).toBeVisible();
  await expect(page.getByText('{ "query": "string", "recency_days": "number?" }')).toBeVisible();
});

test("streams a mocked assistant response without rendering derived tool steps", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Show me a mocked streamed answer with reasoning and tool calls.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByText("Show me a mocked streamed answer with reasoning and tool calls.")
  ).toBeVisible();
  await expect(page.getByText("I should show my reasoning as a separate step.")).toBeVisible();
  await expect(page.getByText("Requested web_search")).toHaveCount(0);
  await expect(
    page.getByText("This is a streamed answer from the mocked Ollama endpoint.")
  ).toBeVisible();
});

test("persists conversations created through the composer across reloads", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Create a persisted conversation title from this prompt.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByText("Create a persisted conversation title from t").first()
  ).toBeVisible();
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("ollamable.conversations");
    return raw?.includes("Create a persisted conversation title from this prompt.");
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Conversation tools" })).toBeHidden();

  await expect(
    page.getByText("Create a persisted conversation title from t").first()
  ).toBeVisible();
  await expect(
    page.getByText("This is a streamed answer from the mocked Ollama endpoint.")
  ).toBeVisible();
});

test("allows editing the conversation title by click or pencil and persists the custom name", async ({
  page,
}) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  await page.getByRole("heading", { name: "New conversation" }).click();
  const titleInput = page.getByRole("textbox", { name: "Conversation name" });
  await titleInput.fill("Clicked title name");
  await titleInput.press("Enter");

  await expect(page.getByRole("heading", { name: "Clicked title name" })).toBeVisible();
  await expect(page.getByText("Clicked title name").first()).toBeVisible();

  await page.getByRole("button", { name: "Edit conversation title" }).click();
  const retitledInput = page.getByRole("textbox", { name: "Conversation name" });
  await retitledInput.fill("Pinned custom conversation");
  await retitledInput.press("Enter");

  await expect(page.getByRole("heading", { name: "Pinned custom conversation" })).toBeVisible();
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("ollamable.conversations");
    return raw?.includes("\"title\":\"Pinned custom conversation\"") && raw.includes("\"titleEdited\":true");
  });

  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("This prompt should not overwrite the edited title.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("heading", { name: "Pinned custom conversation" })).toBeVisible();
  await expect(page.getByText("Pinned custom conversation").first()).toBeVisible();

  await page.reload();
  await closeToolsDrawer(page);

  await expect(page.getByRole("heading", { name: "Pinned custom conversation" })).toBeVisible();
  await expect(page.getByText("Pinned custom conversation").first()).toBeVisible();
});

test("keeps the send button visible when the prompt input grows large", async ({ page }) => {
  await page.goto("/");
  await closeToolsDrawer(page);

  const promptInput = page.getByRole("textbox", { name: "Prompt", exact: true });
  const longPrompt = Array.from(
    { length: 80 },
    (_, index) => `Line ${index + 1} prompt content.`
  ).join("\n");

  await promptInput.fill(longPrompt);

  const promptMetrics = await promptInput.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  const sendButtonBox = await page.getByRole("button", { name: "Send" }).boundingBox();
  const viewport = page.viewportSize();

  expect(promptMetrics.scrollHeight).toBeGreaterThan(promptMetrics.clientHeight);
  expect(promptMetrics.overflowY).toBe("auto");
  expect(sendButtonBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(sendButtonBox!.y + sendButtonBox!.height).toBeLessThanOrEqual(viewport!.height);
});

test("keeps the submit-result button visible when the tool result input grows large", async ({
  page,
}) => {
  const now = "2026-03-20T11:00:00.000Z";
  await seedConversationState(
    page,
    [
      {
        id: "conversation-1",
        title: "Tool result conversation",
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
                query: "very long result input",
              },
            },
          },
        ],
      },
    ],
    "conversation-1"
  );

  await page.goto("/");

  const toolResultInput = page.getByRole("textbox", { name: "Tool result", exact: true });
  const longToolResult = Array.from(
    { length: 100 },
    (_, index) => `Line ${index + 1} tool result content.`
  ).join("\n");

  await toolResultInput.fill(longToolResult);

  const toolResultMetrics = await toolResultInput.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  const submitButtonBox = await page
    .getByRole("button", { name: "Submit result" })
    .boundingBox();
  const viewport = page.viewportSize();

  await expect(
    page.getByText("Provide the result for web_search before sending another prompt.")
  ).toBeVisible();
  expect(toolResultMetrics.scrollHeight).toBeGreaterThan(toolResultMetrics.clientHeight);
  expect(toolResultMetrics.overflowY).toBe("auto");
  expect(submitButtonBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(submitButtonBox!.y + submitButtonBox!.height).toBeLessThanOrEqual(viewport!.height);
});
