/**
 * OpenAI-compatible streaming client for LLM providers.
 * Supports: OpenAI, DeepSeek, Ollama, vLLM, and any OpenAI-compatible endpoint.
 */

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  ollama: "http://localhost:11434/v1",
  vllm: "http://localhost:8000/v1",
};

function getBaseUrl(config: LLMConfig): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/+$/, "");
  return DEFAULT_BASE_URLS[config.provider] ?? DEFAULT_BASE_URLS.openai;
}

export async function streamChat(
  config: LLMConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const baseUrl = getBaseUrl(config);
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const body = JSON.stringify({
    model: config.model,
    messages,
    stream: true,
  });

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body, signal });
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError(
      new Error(`无法连接到 ${config.provider} API: ${(err as Error).message}`),
    );
    return;
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {}
    callbacks.onError(
      new Error(
        `${config.provider} API 错误 (${response.status}): ${detail || response.statusText}`,
      ),
    );
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("无法读取响应流"));
    return;
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            callbacks.onDelta(delta);
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError(new Error(`流读取错误: ${(err as Error).message}`));
    return;
  }

  callbacks.onComplete(fullText);
}
