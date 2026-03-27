import type {
  Conversation,
  ConversationStep,
  OllamaModel,
  StepKind,
  ToolDefinition,
  ToolCallPayload,
  ToolResultPayload,
} from "@/src/types/chat";

export const STORAGE_KEY = "ollamable.conversations";
export const SELECTED_KEY = "ollamable.selectedConversationId";
export const SIDEBAR_STATE_KEY = "ollamable.sidebarState";

export interface SidebarState {
  sidebarOpen: boolean;
  rightSidebarOpen: boolean;
  modelSectionOpen: boolean;
  tempSectionOpen: boolean;
  maxTokensSectionOpen: boolean;
  toolsSectionOpen: boolean;
  /** Per-subsection collapse: key = "builtin" | "mcp-{serverName}" | provider name */
  subsections: Record<string, boolean>;
}

const DEFAULT_SIDEBAR_STATE: SidebarState = {
  sidebarOpen: true,
  rightSidebarOpen: false,
  modelSectionOpen: false,
  tempSectionOpen: false,
  maxTokensSectionOpen: false,
  toolsSectionOpen: false,
  subsections: {},
};

export function loadSidebarState(): SidebarState {
  const raw = window.localStorage.getItem(SIDEBAR_STATE_KEY);
  if (!raw) return { ...DEFAULT_SIDEBAR_STATE };
  try {
    return { ...DEFAULT_SIDEBAR_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SIDEBAR_STATE };
  }
}

export function saveSidebarState(state: SidebarState): void {
  window.localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(state));
}

export const fallbackModels: OllamaModel[] = [
  {
    name: "qwen3:latest",
    family: "qwen",
    families: ["qwen"],
    parameterSize: "8B",
  },
  {
    name: "llama3.2:latest",
    family: "llama",
    families: ["llama"],
    parameterSize: "3B",
  },
];

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
}

export function createStep(
  kind: StepKind,
  title: string,
  content: string,
  toolCall?: ToolCallPayload,
  toolResult?: ToolResultPayload
): ConversationStep {
  return {
    id: createId(),
    kind,
    title,
    content,
    createdAt: new Date().toISOString(),
    expanded: true,
    toolCall,
    toolResult,
  };
}

export function createConversation(model: string, tools: ToolDefinition[] = [], provider?: string): Conversation {
  const now = new Date().toISOString();
  const systemStep = createStep("system", "System Prompt", "");

  return {
    id: createId(),
    title: "New conversation",
    titleEdited: false,
    model,
    provider,
    systemPrompt: "",
    createdAt: now,
    updatedAt: now,
    availableTools: tools,
    activeToolIds: [],
    steps: [systemStep],
  };
}

export function inferTitle(steps: ConversationStep[]): string {
  const firstUserStep = steps.find((step) => step.kind === "user");
  if (!firstUserStep) {
    return "New conversation";
  }

  return firstUserStep.content.slice(0, 42) || "New conversation";
}

export function saveConversations(conversations: Conversation[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

export function ensureSystemPromptStep(conversation: Conversation): Conversation {
  const systemPrompt = conversation.systemPrompt ?? "";
  const now = new Date().toISOString();
  const existingSystemStep = conversation.steps.find((step) => step.kind === "system");
  const otherSteps = conversation.steps.filter((step) => step.kind !== "system");
  const systemStep =
    existingSystemStep != null
      ? {
          ...existingSystemStep,
          title: "System Prompt",
          content: systemPrompt,
          expanded: existingSystemStep.expanded ?? true,
        }
      : {
          id: createId(),
          kind: "system" as const,
          title: "System Prompt",
          content: systemPrompt,
          createdAt: conversation.createdAt || now,
          expanded: true,
        };

  return {
    ...conversation,
    titleEdited: conversation.titleEdited ?? false,
    systemPrompt,
    availableTools: conversation.availableTools ?? [],
    activeToolIds: conversation.activeToolIds ?? [],
    steps: [systemStep, ...otherSteps],
  };
}

export function loadConversations(tools: ToolDefinition[]): Conversation[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [createConversation(fallbackModels[0].name, tools)];
  }

  try {
    const parsed = JSON.parse(raw) as Conversation[];
    return parsed.map((conversation) => ensureConversationTools(ensureSystemPromptStep(conversation), tools));
  } catch {
    return [createConversation(fallbackModels[0].name, tools)];
  }
}

export function ensureConversationTools(
  conversation: Conversation,
  tools: ToolDefinition[]
): Conversation {
  const existingTools = conversation.availableTools ?? [];
  const mergedTools = [
    ...tools,
    ...existingTools.filter(
      (tool) => !tools.some((configuredTool) => configuredTool.id === tool.id)
    ),
  ];
  const activeToolIds = (conversation.activeToolIds ?? []).filter((toolId) =>
    mergedTools.some((tool) => tool.id === toolId)
  );

  return {
    ...conversation,
    availableTools: mergedTools,
    activeToolIds,
  };
}

export function saveSelectedConversationId(id: string): void {
  if (id) {
    window.localStorage.setItem(SELECTED_KEY, id);
    return;
  }

  window.localStorage.removeItem(SELECTED_KEY);
}

export function loadSelectedConversationId(): string | null {
  return window.localStorage.getItem(SELECTED_KEY);
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
