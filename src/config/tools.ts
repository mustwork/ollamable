import type { ToolDefinition } from "@/src/types/chat";

export const configuredTools: ToolDefinition[] = [
  {
    id: "web-search",
    name: "web_search",
    description: "Searches the web and returns a short source-backed summary.",
    inputSchema: `{
  "query": "string",
  "recency_days": "number?"
}`,
  },
];
