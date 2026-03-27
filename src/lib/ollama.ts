import type {
  OllamaModel,
  OllamaModelMeta,
  ToolDefinition,
} from "@/src/types/chat";
import { WS_URL } from "@/src/lib/backend-client";

/** Derive the backend HTTP URL from the WebSocket URL. */
function backendHttpUrl(): string {
  return WS_URL.replace(/^ws/, "http");
}

/**
 * Fetch models from the backend server which aggregates all configured
 * providers.
 */
export async function fetchAllModels(): Promise<OllamaModel[]> {
  const response = await fetch(`${backendHttpUrl()}/models`);
  if (!response.ok) {
    throw new Error(`Backend /models failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    models: Array<{
      name: string;
      provider?: string;
      providerName?: string;
      family?: string;
      families?: string[];
      parameterSize?: string;
      format?: string;
      quantizationLevel?: string;
      capabilities?: string[];
    }>;
  };

  return data.models.map((m) => ({
    name: m.name,
    provider: m.provider,
    providerName: m.providerName,
    family: m.family,
    families: m.families,
    parameterSize: m.parameterSize,
    format: m.format,
    quantizationLevel: m.quantizationLevel,
    capabilities: m.capabilities,
  }));
}

/**
 * Fetch available tool definitions from the backend server.
 */
export async function fetchTools(): Promise<ToolDefinition[]> {
  const response = await fetch(`${backendHttpUrl()}/tools`);
  if (!response.ok) {
    throw new Error(`Backend /tools failed: ${response.status}`);
  }

  const data = (await response.json()) as { tools: ToolDefinition[] };
  return data.tools;
}

/**
 * Fetch model metadata from the backend server.
 * Only supported for Ollama models.
 */
export async function fetchModelMeta(model: OllamaModel): Promise<OllamaModelMeta> {
  const response = await fetch(`${backendHttpUrl()}/models/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.name,
      provider: model.provider,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Backend /models/show failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    license?: string;
    modelfile?: string;
    parameters?: string;
    template?: string;
    system?: string;
    details?: {
      parent_model?: string;
      format?: string;
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
    };
    model_info?: Record<string, string | number | boolean | undefined>;
    capabilities?: string[];
    modified_at?: string;
  };

  return {
    name: model.name,
    modifiedAt: model.modifiedAt ?? data.modified_at,
    family: data.details?.family ?? model.family,
    families: data.details?.families ?? model.families,
    parentModel: data.details?.parent_model ?? model.parentModel,
    format: data.details?.format ?? model.format,
    parameterSize: data.details?.parameter_size ?? model.parameterSize,
    quantizationLevel: data.details?.quantization_level ?? model.quantizationLevel,
    license: data.license,
    system: data.system,
    template: data.template,
    parameters: data.parameters,
    details: data.details
      ? {
          parent_model: data.details.parent_model,
          format: data.details.format,
          family: data.details.family,
          families: data.details.families,
          parameter_size: data.details.parameter_size,
          quantization_level: data.details.quantization_level,
        }
      : undefined,
    modelInfo: data.model_info,
    capabilities: data.capabilities,
  };
}
