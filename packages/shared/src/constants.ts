export const APP_NAME = "My Easy Claw";
export const APP_VERSION = "0.1.0";

// WebSocket
export const WS_PING_INTERVAL_MS = 30_000;
export const WS_RECONNECT_DELAY_MS = 3_000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;

// Internal HTTP Server (Node → Rust)
export const INTERNAL_SERVER_HOST = "127.0.0.1";

// SQLite
export const DB_FILE_NAME = "my-easy-claw.db";

// Chroma
export const CHROMA_COLLECTION_MEMORY = "long_term_memory";
export const CHROMA_COLLECTION_DOCS = "document_knowledge";
export const CHROMA_COLLECTION_CODE = "code_snippets";

// Security
export const SHELL_BLOCKED_COMMANDS = [
  "rm -rf /",
  "format",
  "del /s /q",
  "reg delete",
  "shutdown",
  "taskkill /f /im",
] as const;

export const FILE_BLOCKED_PATHS_WIN = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
] as const;

// IPC Error Codes
export const ErrorCodes = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED",
  SHELL_TIMEOUT: "SHELL_TIMEOUT",
  SHELL_BLOCKED: "SHELL_BLOCKED",
  DB_QUERY_ERROR: "DB_QUERY_ERROR",
  AGENT_CANCELLED: "AGENT_CANCELLED",
  AGENT_PROVIDER_ERROR: "AGENT_PROVIDER_ERROR",
  SIDECAR_NOT_READY: "SIDECAR_NOT_READY",
  SIDECAR_CRASHED: "SIDECAR_CRASHED",
  WS_CONNECTION_FAILED: "WS_CONNECTION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
