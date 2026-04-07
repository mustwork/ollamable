/**
 * Unit tests for `buildOllamaChatBody` covering reasoning effort.
 *
 * Lives under tests/integration/ because the helper imports server-only
 * modules that are not part of the jsdom unit-test bundle.
 */

import { describe, it, expect } from "vitest";
import { buildOllamaChatBody } from "../../server/ollama-client.js";
import type { ConversationStep, ToolDefinition } from "../../server/types.js";

const userStep: ConversationStep = {
  id: "u1",
  kind: "user",
  title: "User",
  content: "Hello",
  createdAt: new Date().toISOString(),
};

const noTools: ToolDefinition[] = [];

describe("buildOllamaChatBody", () => {
  it("omits the think field when reasoningEffort is not provided", () => {
    const body = buildOllamaChatBody({
      model: "qwen3:latest",
      steps: [userStep],
      tools: noTools,
      stream: false,
    }) as Record<string, unknown>;

    expect(body).not.toHaveProperty("think");
  });

  it("includes think with the reasoningEffort value when provided", () => {
    const body = buildOllamaChatBody({
      model: "qwen3:latest",
      steps: [userStep],
      tools: noTools,
      stream: false,
      reasoningEffort: "medium",
    }) as Record<string, unknown>;

    expect(body.think).toBe("medium");
  });

  it("includes options.temperature and options.num_predict when provided", () => {
    const body = buildOllamaChatBody({
      model: "qwen3:latest",
      steps: [userStep],
      tools: noTools,
      stream: false,
      temperature: 0.4,
      maxOutputTokens: 100,
    }) as Record<string, unknown>;

    expect(body.options).toEqual({ temperature: 0.4, num_predict: 100 });
  });
});
