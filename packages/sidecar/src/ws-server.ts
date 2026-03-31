import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import type { AgentManager } from "./agent-manager.js";
import type { WSMessage, ChatRequest } from "@my-easy-claw/shared";

interface WSServerHandle {
  port: number;
  close: () => void;
}

export async function createWSServer(
  agentManager: AgentManager,
): Promise<WSServerHandle> {
  const server = createServer();
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    socket.on("message", async (raw) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "chat":
          await handleChat(socket, msg.payload as ChatRequest, agentManager);
          break;
        case "cancel":
          agentManager.cancel(
            (msg.payload as { session_id: string }).session_id,
          );
          break;
        case "ping":
          send(socket, { id: msg.id, type: "pong", payload: null });
          break;
      }
    });
  });

  return new Promise((resolve) => {
    // 端口 0 = OS 自动分配
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => {
          wss.close();
          server.close();
        },
      });
    });
  });
}

async function handleChat(
  socket: WebSocket,
  request: ChatRequest,
  agentManager: AgentManager,
) {
  const onEvent = (event: unknown) => {
    send(socket, {
      id: crypto.randomUUID(),
      type: "event",
      payload: event,
    });
  };

  try {
    await agentManager.chat(request, onEvent);
  } catch (err) {
    send(socket, {
      id: crypto.randomUUID(),
      type: "event",
      payload: {
        type: "error",
        session_id: request.session_id,
        data: { message: String(err) },
        timestamp: Date.now(),
      },
    });
  }
}

function send(socket: WebSocket, data: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}
