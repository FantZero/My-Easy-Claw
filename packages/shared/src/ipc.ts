// ── IPC 统一消息格式 ──

export interface IPCMessage<T = unknown> {
  id: string;
  type: "request" | "response" | "event" | "error";
  channel: string;
  payload: T;
  timestamp: number;
}

export interface IPCError {
  code: string;
  message: string;
  details?: unknown;
}

export interface IPCResponse<T = unknown> {
  id: string;
  type: "response";
  channel: string;
  payload: T;
  timestamp: number;
}

export interface IPCErrorResponse {
  id: string;
  type: "error";
  channel: string;
  payload: IPCError;
  timestamp: number;
}

// ── IPC Channel 命名空间 ──

export type FileChannel =
  | "file:read"
  | "file:write"
  | "file:list"
  | "file:delete"
  | "file:watch"
  | "file:unwatch";

export type ShellChannel =
  | "shell:exec"
  | "shell:spawn"
  | "shell:kill"
  | "shell:output";

export type DBChannel =
  | "db:query"
  | "db:execute"
  | "db:migrate";

export type AgentChannel =
  | "agent:chat"
  | "agent:cancel"
  | "agent:status";

export type SidecarChannel =
  | "sidecar:ready"
  | "sidecar:health"
  | "sidecar:shutdown";

export type IPCChannel =
  | FileChannel
  | ShellChannel
  | DBChannel
  | AgentChannel
  | SidecarChannel;

// ── JSON-RPC 2.0（Node → Rust 内部通信）──

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}
