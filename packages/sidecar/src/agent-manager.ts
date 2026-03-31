import type { RustBridge } from "./rust-bridge.js";
import type {
  ChatRequest,
  AgentEvent,
  ToolDefinition,
} from "@my-easy-claw/shared";

type EventCallback = (event: AgentEvent) => void;

/**
 * Agent 管理器，封装 pi-agent-core 的会话生命周期。
 *
 * 当前为骨架实现，后续接入 pi-agent-core 后替换内部逻辑。
 */
export class AgentManager {
  private activeSessions = new Map<string, AbortController>();
  private rustBridge: RustBridge;

  constructor(rustBridge: RustBridge) {
    this.rustBridge = rustBridge;
  }

  async chat(request: ChatRequest, onEvent: EventCallback): Promise<void> {
    const { session_id, content } = request;

    const controller = new AbortController();
    this.activeSessions.set(session_id, controller);

    onEvent({
      type: "agent_start",
      session_id,
      data: { session_id },
      timestamp: Date.now(),
    });

    onEvent({
      type: "turn_start",
      session_id,
      data: {},
      timestamp: Date.now(),
    });

    // TODO: 接入 pi-agent-core
    // 骨架实现：回显用户消息
    if (!controller.signal.aborted) {
      onEvent({
        type: "message",
        session_id,
        data: {
          content: `[Agent 骨架] 收到消息: "${content}"。pi-agent-core 尚未接入。`,
        },
        timestamp: Date.now(),
      });
    }

    onEvent({
      type: "turn_end",
      session_id,
      data: {},
      timestamp: Date.now(),
    });

    onEvent({
      type: "agent_end",
      session_id,
      data: {},
      timestamp: Date.now(),
    });

    this.activeSessions.delete(session_id);
  }

  cancel(sessionId: string): void {
    const controller = this.activeSessions.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeSessions.delete(sessionId);
    }
  }

  getSystemTools(): ToolDefinition[] {
    return [
      {
        name: "file_read",
        description: "Read file contents from the local filesystem",
        category: "system",
        parameters: {
          path: {
            type: "string",
            description: "Absolute or relative file path",
            required: true,
          },
        },
      },
      {
        name: "file_write",
        description: "Write content to a file",
        category: "system",
        parameters: {
          path: {
            type: "string",
            description: "File path to write to",
            required: true,
          },
          content: {
            type: "string",
            description: "Content to write",
            required: true,
          },
        },
      },
      {
        name: "shell_exec",
        description: "Execute a shell command",
        category: "system",
        parameters: {
          command: {
            type: "string",
            description: "The shell command to execute",
            required: true,
          },
          cwd: {
            type: "string",
            description: "Working directory",
            required: false,
          },
        },
      },
      {
        name: "db_query",
        description: "Execute a read-only SQL query",
        category: "system",
        parameters: {
          sql: {
            type: "string",
            description: "SQL query string",
            required: true,
          },
        },
      },
    ];
  }

  async shutdown(): Promise<void> {
    for (const [sessionId, controller] of this.activeSessions) {
      controller.abort();
    }
    this.activeSessions.clear();
  }
}
