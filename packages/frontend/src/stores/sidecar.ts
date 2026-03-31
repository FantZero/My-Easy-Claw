import { defineStore } from "pinia";
import { ref, readonly } from "vue";
import { listen } from "@tauri-apps/api/event";
import {
  WS_RECONNECT_DELAY_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
  WS_PING_INTERVAL_MS,
} from "@my-easy-claw/shared";

export const useSidecarStore = defineStore("sidecar", () => {
  const isReady = ref(false);
  const wsPort = ref<number | null>(null);
  const ws = ref<WebSocket | null>(null);
  const reconnectAttempts = ref(0);

  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let unlisten: (() => void) | null = null;

  const eventHandlers = new Map<string, Set<(data: unknown) => void>>();

  async function init() {
    unlisten = (await listen<{ port: number }>("sidecar-ready", (event) => {
      wsPort.value = event.payload.port;
      connectWebSocket();
    })) as unknown as () => void;
  }

  function connectWebSocket() {
    if (!wsPort.value) return;

    const socket = new WebSocket(`ws://127.0.0.1:${wsPort.value}`);

    socket.onopen = () => {
      isReady.value = true;
      reconnectAttempts.value = 0;
      startPing(socket);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const handlers = eventHandlers.get(msg.type);
        if (handlers) {
          handlers.forEach((fn) => fn(msg.payload));
        }
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = () => {
      isReady.value = false;
      stopPing();
      attemptReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };

    ws.value = socket;
  }

  function attemptReconnect() {
    if (reconnectAttempts.value >= WS_MAX_RECONNECT_ATTEMPTS) return;
    reconnectAttempts.value++;
    setTimeout(connectWebSocket, WS_RECONNECT_DELAY_MS);
  }

  function startPing(socket: WebSocket) {
    stopPing();
    pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, WS_PING_INTERVAL_MS);
  }

  function stopPing() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  function send(type: string, payload: unknown): void {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(
        JSON.stringify({
          id: crypto.randomUUID(),
          type,
          payload,
        }),
      );
    }
  }

  function on(type: string, handler: (data: unknown) => void): () => void {
    if (!eventHandlers.has(type)) {
      eventHandlers.set(type, new Set());
    }
    eventHandlers.get(type)!.add(handler);
    return () => eventHandlers.get(type)?.delete(handler);
  }

  function cleanup() {
    stopPing();
    ws.value?.close();
    ws.value = null;
    unlisten?.();
    unlisten = null;
    eventHandlers.clear();
  }

  return {
    isReady: readonly(isReady),
    init,
    send,
    on,
    cleanup,
  };
});
