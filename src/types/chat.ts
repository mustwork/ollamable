export type StepKind =
  | "system"
  | "user"
  | "assistant"
  | "reasoning"
  | "tool_call"
  | "tool_result";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: string;
}

export interface ToolCallPayload {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultPayload {
  name: string;
}

export interface ConversationStep {
  id: string;
  kind: StepKind;
  title: string;
  content: string;
  createdAt: string;
  expanded?: boolean;
  toolCall?: ToolCallPayload;
  toolResult?: ToolResultPayload;
}

export interface Conversation {
  id: string;
  title: string;
  titleEdited?: boolean;
  model: string;
  temperature?: number;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
  availableTools: ToolDefinition[];
  activeToolIds: string[];
  steps: ConversationStep[];
}

export interface OllamaModel {
  name: string;
  parameterSize?: string;
  family?: string;
  families?: string[];
  modifiedAt?: string;
  parentModel?: string;
  format?: string;
  quantizationLevel?: string;
}

export interface OllamaModelMeta {
  name: string;
  modifiedAt?: string;
  family?: string;
  families?: string[];
  parentModel?: string;
  format?: string;
  parameterSize?: string;
  quantizationLevel?: string;
  license?: string;
  system?: string;
  template?: string;
  parameters?: string;
  details?: Record<string, string | number | boolean | string[] | undefined>;
  modelInfo?: Record<string, string | number | boolean | undefined>;
  capabilities?: string[];
}
