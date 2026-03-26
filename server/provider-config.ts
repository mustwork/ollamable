export interface ProviderConfig {
  id: string;
  type: "ollama" | "openai-compat";
  name: string;
  baseUrl: string;
  apiKey?: string;
}

/**
 * Build the list of enabled LLM providers from environment variables.
 *
 * - Ollama is always included (local, no API key required).
 * - MiniMax is enabled when MINIMAX_API_KEY is set.
 *
 * Additional OpenAI-compatible providers can be added here by following
 * the same pattern: check for an API key env var and push a config entry.
 */
export function loadProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [
    {
      id: "ollama",
      type: "ollama",
      name: "Ollama",
      baseUrl: process.env.OLLAMA_URL ?? "http://localhost:11434/api",
    },
  ];

  if (process.env.MINIMAX_API_KEY) {
    configs.push({
      id: "minimax",
      type: "openai-compat",
      name: "MiniMax",
      baseUrl:
        process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.chat/v1",
      apiKey: process.env.MINIMAX_API_KEY,
    });
  }

  return configs;
}
