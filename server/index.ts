import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ConnectionHandler } from "./ws-handler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
const MCP_CONFIG = process.env.MCP_CONFIG ?? resolve(__dirname, "mcp-config.json");

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "ollamable-server" }));
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  console.log("[ws] client connected");
  const handler = new ConnectionHandler(ws);
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
