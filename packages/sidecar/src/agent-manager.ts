import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

function log(msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [sidecar] ${msg}`, ...args);
}

/**
 * Windows 上查找真正的 Git Bash（排除 WSL 的 bash.exe）。
 * 查找顺序：标准安装 → Scoop → PATH（过滤 System32/WindowsApps）
 */
function findGitBash(): string | null {
  if (process.platform !== "win32") return null;

  const candidates: string[] = [];

  const pf = process.env["ProgramFiles"];
  if (pf) candidates.push(`${pf}\\Git\\bin\\bash.exe`);

  const pf86 = process.env["ProgramFiles(x86)"];
  if (pf86) candidates.push(`${pf86}\\Git\\bin\\bash.exe`);

  const home = process.env["USERPROFILE"];
  if (home) candidates.push(`${home}\\scoop\\apps\\git\\current\\bin\\bash.exe`);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  try {
    const out = execFileSync("where", ["bash.exe"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (!p) continue;
      const lower = p.toLowerCase();
      if (lower.includes("\\system32\\") || lower.includes("\\windowsapps\\"))
        continue;
      if (existsSync(p)) return p;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Ensure pi-coding-agent uses Git Bash on Windows.
 *
 * getShellConfig() in pi-coding-agent reads shellPath from ~/.pi/agent/settings.json
 * and has a module-level cache. Neither settingsManager nor custom tools passed to
 * createAgentSession can override it. We write directly to the settings file
 * so getShellConfig() picks up the correct path on first call.
 */
function ensureGitBashInSettings(): void {
  if (process.platform !== "win32") return;

  const bashPath = findGitBash();
  if (!bashPath) {
    log("Git Bash not found, using pi-coding-agent default shell");
    return;
  }

  const agentDir = join(homedir(), ".pi", "agent");
  const settingsPath = join(agentDir, "settings.json");

  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }

    if (settings.shellPath === bashPath) {
      log("settings.json already has shellPath: %s", bashPath);
      return;
    }

    settings.shellPath = bashPath;

    mkdirSync(agentDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    log("Wrote shellPath to %s → %s", settingsPath, bashPath);
  } catch (err) {
    log("Failed to write shellPath to settings.json: %s", (err as Error).message);
  }
}

ensureGitBashInSettings();

import {
  createAgentSession,
  AuthStorage,
  SessionManager,
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
  const model = getModel(provider as never, modelId as never) as
    | Model<Api>
    | undefined;

  if (model) {
    if (baseUrl) return { ...model, baseUrl };
    return model;
  }

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

    log("chat start | session=%s provider=%s model=%s", session_id, provider, modelName);
    log("user prompt: %s", content.length > 200 ? content.slice(0, 200) + "..." : content);

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

        log("creating new agent session (cwd: %s)", this.cwd);

        const { session } = await createAgentSession({
          cwd: this.cwd,
          model: model as never,
          authStorage,
          sessionManager: SessionManager.inMemory(),
        });

        piSession = session as unknown as PiSessionHandle;
        this.piSessions.set(session_id, piSession);
        log("agent session created");
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
      log("chat error: %s", (err as Error).message);
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

    log("chat end | session=%s hasError=%s", session_id, hasError);
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
        log("tool_start: %s | input: %s", event.toolName, JSON.stringify(event.args)?.slice(0, 300));
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

      case "tool_execution_end": {
        const outputPreview = JSON.stringify(event.result)?.slice(0, 500);
        log("tool_end: %s | status: %s | output: %s", event.toolName, event.isError ? "error" : "success", outputPreview);
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
