// ── SQLite 数据模型 ──

export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCallRecord[];
  timestamp: number;
}

export interface ToolCallRecord {
  id?: string;
  tool_name: string;
  input: unknown;
  output?: unknown;
  duration_ms?: number;
  status: "running" | "success" | "error" | "cancelled";
}

export interface ProviderConfig {
  id: string;
  provider: LLMProvider;
  model: string;
  base_url?: string;
  api_key?: string;
  is_default: boolean;
}

export type LLMProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "ollama"
  | "vllm"
  | "custom";

// ── Chroma 向量存储 ──

export interface VectorDocument {
  id: string;
  content: string;
  metadata: Record<string, string | number | boolean>;
  collection: VectorCollection;
}

export type VectorCollection =
  | "long_term_memory"
  | "document_knowledge"
  | "code_snippets";
