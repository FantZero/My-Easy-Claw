// ── Agent 事件类型 ──

export type AgentEventType =
  | "agent_start"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "message"
  | "message_delta"
  | "tool_execution_start"
  | "tool_execution_end"
  | "error";

export interface AgentEvent<T = unknown> {
  type: AgentEventType;
  session_id: string;
  data: T;
  timestamp: number;
}

export interface AgentStartData {
  session_id: string;
  model: string;
  provider: string;
}

export interface ToolExecutionData {
  tool_name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "success" | "error";
}

export interface ToolExecutionStartData {
  tool_name: string;
  input: unknown;
  status: "running";
}

export interface ToolExecutionEndData {
  tool_name: string;
  input: unknown;
  output: unknown;
  status: "success" | "error";
}

// ── WebSocket 消息（Vue ↔ Node）──

export interface WSMessage<T = unknown> {
  id: string;
  type: "chat" | "cancel" | "event" | "ping" | "pong";
  payload: T;
}

export interface ChatRequest {
  session_id: string;
  content: string;
  provider?: string;
  model?: string;
  base_url?: string;
  api_key?: string;
  attachments?: Attachment[];
}

export interface Attachment {
  type: "file" | "image" | "document";
  name: string;
  mime_type: string;
  data: string; // base64
}

// ── Tool 定义 ──

export interface ToolDefinition {
  name: string;
  description: string;
  category: "builtin" | "system" | "mcp";
  parameters: Record<string, ToolParameter>;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  default?: unknown;
}
