import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ConnectionHandler } from "./ws-handler.js";
import { LlmRouter } from "./llm-router.js";
import { ToolDispatcher } from "./tool-executor.js";
import { WebSearchExecutor } from "./tools/web-search.js";
import { loadProviderConfigs } from "./provider-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// Load .env / .envrc so the backend picks up the same env vars as Next.js.
for (const envFile of [".env", ".envrc"]) {
  try {
    const raw = readFileSync(resolve(PROJECT_ROOT, envFile), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.replace(/^export\s+/, "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // File not found — skip
  }
}
const PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
const MCP_CONFIG = process.env.MCP_CONFIG ?? resolve(__dirname, "mcp-config.json");

const providerConfigs = loadProviderConfigs();
const router = new LlmRouter(providerConfigs);

// Static tool registry — used by the /tools HTTP endpoint.
// MCP tools are per-connection and delivered via WebSocket tools.update instead.
const staticDispatcher = new ToolDispatcher();
staticDispatcher.register(new WebSearchExecutor());

console.log(
  `[server] Providers: ${providerConfigs.map((p) => p.name).join(", ")}`
);
console.log(
  `[server] Tools: ${staticDispatcher.getToolDefinitions().map((t) => t.name).join(", ") || "(none)"}`
);

// ── HTTP server with /models endpoint ────────────────────────────────

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for frontend fetch
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/models" && req.method === "GET") {
      try {
        const models = await router.listAllModels();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models }));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch models";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    if (req.url === "/tools" && req.method === "GET") {
      const tools = staticDispatcher.getToolDefinitions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tools }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "ollamable-server" }));
  }
);

// ── WebSocket server ─────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  console.log("[ws] client connected");
  const handler = new ConnectionHandler(ws, router);
  void handler.initMcp(MCP_CONFIG);

  ws.on("close", () => {
    console.log("[ws] client disconnected");
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Ollamable backend listening on ws://localhost:${PORT}`);
});

function shutdown() {
  console.log("[server] shutting down...");
  wss.close();
  httpServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
