import { useCallback, useEffect, useRef, useState } from "react";

const RECONNECT_DELAY_MS = 2000;
const PING_INTERVAL_MS = 30_000;

export interface UseWebSocketResult {
  send: (data: unknown) => void;
  connected: boolean;
  lastMessage: unknown | null;
}

export function useWebSocket(
  url: string,
  onMessage?: (data: unknown) => void
): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<unknown | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  onMessageRef.current = onMessage;

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "pong") return;
        setLastMessage(data);
        onMessageRef.current?.(data);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      cleanup();
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }, [url, cleanup]);

  useEffect(() => {
    connect();
    return () => {
      cleanup();
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional cleanup
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [connect, cleanup]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send, connected, lastMessage };
}
