import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ChatRequest, AgentEvent } from "@my-easy-claw/shared";

type EventCallback = (event: AgentEvent) => void;

const DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  ollama: "http://localhost:11434/v1",
  vllm: "http://localhost:8000/v1",
};

function resolveModel(
  provider: string,
  modelId: string,
  baseUrl?: string,
): Model<Api> {
  try {
    const model = getModel(provider as never, modelId as never) as Model<Api>;
    if (baseUrl) return { ...model, baseUrl };
    return model;
  } catch {
    return {
      id: modelId,
      name: modelId,
      api: "openai-completions" as Api,
      provider,
      baseUrl:
        baseUrl ||
        DEFAULT_BASE_URLS[provider] ||
        "https://api.openai.com/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
  }
}

interface PiSessionHandle {
  prompt: (text: string, options?: unknown) => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
  abort: () => Promise<void>;
}

export class AgentManager {
  private piSessions = new Map<string, PiSessionHandle>();
  private pendingAborts = new Map<string, () => Promise<void>>();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async chat(request: ChatRequest, onEvent: EventCallback): Promise<void> {
    const { session_id, content } = request;
    const provider = request.provider ?? "openai";
    const modelName = request.model ?? "gpt-4o";

    if (!request.api_key && !["ollama", "vllm"].includes(provider)) {
      this.emitError(
        session_id,
        onEvent,
        `请先在设置中配置 ${provider} 的 API Key`,
      );
      return;
    }

    onEvent({
      type: "agent_start",
      session_id,
      data: { session_id, model: modelName, provider },
      timestamp: Date.now(),
    });

    let hasError = false;

    try {
      let piSession = this.piSessions.get(session_id);

      if (!piSession) {
        const authStorage = AuthStorage.inMemory();
        if (request.api_key) {
          authStorage.setRuntimeApiKey(provider, request.api_key);
        }

        const model = resolveModel(provider, modelName, request.base_url);

        const { session } = await createAgentSession({
          cwd: this.cwd,
          model: model as never,
          authStorage,
          tools: createCodingTools(this.cwd),
          sessionManager: SessionManager.inMemory(),
        });

        piSession = session as unknown as PiSessionHandle;
        this.piSessions.set(session_id, piSession);
      }

      const unsubscribe = piSession.subscribe((event: unknown) => {
        this.mapAndEmit(session_id, event, onEvent);
      });

      this.pendingAborts.set(session_id, () => piSession!.abort());

      try {
        await piSession.prompt(content);
      } finally {
        unsubscribe();
        this.pendingAborts.delete(session_id);
      }
    } catch (err) {
      hasError = true;
      onEvent({
        type: "error",
        session_id,
        data: {
          message: (err as Error).message,
          content: (err as Error).message,
        },
        timestamp: Date.now(),
      });
    }

    onEvent({
      type: "agent_end",
      session_id,
      data: {},
      timestamp: Date.now(),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapAndEmit(
    sessionId: string,
    event: any,
    onEvent: EventCallback,
  ): void {
    switch (event.type) {
      case "turn_start":
        onEvent({
          type: "turn_start",
          session_id: sessionId,
          data: {},
          timestamp: Date.now(),
        });
        break;

      case "turn_end":
        onEvent({
          type: "turn_end",
          session_id: sessionId,
          data: {},
          timestamp: Date.now(),
        });
        break;

      case "message_update":
        if (event.assistantMessageEvent?.type === "text_delta") {
          onEvent({
            type: "message_delta",
            session_id: sessionId,
            data: { content: event.assistantMessageEvent.delta },
            timestamp: Date.now(),
          });
        }
        break;

      case "tool_execution_start":
        onEvent({
          type: "tool_execution_start",
          session_id: sessionId,
          data: {
            tool_name: event.toolName,
            input: event.args,
            status: "running" as const,
          },
          timestamp: Date.now(),
        });
        break;

      case "tool_execution_end":
        onEvent({
          type: "tool_execution_end",
          session_id: sessionId,
          data: {
            tool_name: event.toolName,
            input: event.args,
            output: event.result,
            status: (event.isError ? "error" : "success") as
              | "error"
              | "success",
          },
          timestamp: Date.now(),
        });
        break;
    }
  }

  cancel(sessionId: string): void {
    const abortFn = this.pendingAborts.get(sessionId);
    if (abortFn) {
      abortFn();
      this.pendingAborts.delete(sessionId);
    }
  }

  async shutdown(): Promise<void> {
    for (const [, abortFn] of this.pendingAborts) {
      await abortFn();
    }
    this.pendingAborts.clear();
    this.piSessions.clear();
  }

  private emitError(
    sessionId: string,
    onEvent: EventCallback,
    message: string,
  ): void {
    onEvent({
      type: "error",
      session_id: sessionId,
      data: { message, content: message },
      timestamp: Date.now(),
    });
    onEvent({
      type: "turn_end",
      session_id: sessionId,
      data: {},
      timestamp: Date.now(),
    });
    onEvent({
      type: "agent_end",
      session_id: sessionId,
      data: {},
      timestamp: Date.now(),
    });
  }
}
