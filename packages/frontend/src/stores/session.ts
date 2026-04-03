import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useSidecarStore } from "./sidecar";
import { useSettingsStore } from "./settings";
import type { Session, Message, ToolCallRecord } from "@my-easy-claw/shared";

const CURRENT_SESSION_STORAGE_KEY = "my-easy-claw.current-session-id";

interface StreamEvent {
  type: string;
  session_id: string;
  data: {
    content?: string;
    message?: string;
    tool_name?: string;
    input?: unknown;
    output?: unknown;
    status?: string;
  };
}

interface PersistedMessagePayload {
  id: string;
  session_id: string;
  role: Message["role"];
  content: string;
  tool_calls?: string | ToolCallRecord[] | null;
  timestamp: number;
}

export const useSessionStore = defineStore("session", () => {
  const sessions = ref<Session[]>([]);
  const currentSessionId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const persistTimers = new Map<string, number>();

  const currentSession = computed(() =>
    sessions.value.find((s) => s.id === currentSessionId.value) ?? null,
  );

  function getPersistedCurrentSessionId(): string | null {
    try {
      return window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function setPersistedCurrentSessionId(id: string | null) {
    try {
      if (id) {
        window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, id);
      } else {
        window.localStorage.removeItem(CURRENT_SESSION_STORAGE_KEY);
      }
    } catch {
      // ignore storage write failures
    }
  }

  function parseToolCalls(
    value: PersistedMessagePayload["tool_calls"],
  ): ToolCallRecord[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  function deserializeMessage(message: PersistedMessagePayload): Message {
    return {
      ...message,
      tool_calls: parseToolCalls(message.tool_calls),
    };
  }

  function serializeMessage(message: Message): PersistedMessagePayload {
    return {
      ...message,
      tool_calls: message.tool_calls?.length
        ? JSON.stringify(message.tool_calls)
        : null,
    };
  }

  async function persistMessage(message: Message) {
    try {
      await invoke("cmd_upsert_message", {
        message: serializeMessage(message),
      });
    } catch (error) {
      console.error("Failed to persist message:", error);
    }
  }

  function queuePersistMessage(message: Message, delay = 200) {
    const existing = persistTimers.get(message.id);
    if (existing) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      persistTimers.delete(message.id);
      void persistMessage(message);
    }, delay);

    persistTimers.set(message.id, timer);
  }

  function flushPersistMessage(message: Message) {
    const existing = persistTimers.get(message.id);
    if (existing) {
      window.clearTimeout(existing);
      persistTimers.delete(message.id);
    }
    void persistMessage(message);
  }

  function updateLocalSession(sessionId: string, updatedAt: number, titleHint?: string) {
    const index = sessions.value.findIndex((s) => s.id === sessionId);
    if (index === -1) return;

    const next = { ...sessions.value[index], updated_at: updatedAt };
    if (titleHint && (next.title === "新对话" || !next.title.trim())) {
      const firstLine = titleHint.trim().split(/\r?\n/, 1)[0] ?? "";
      next.title = firstLine.length > 24 ? `${firstLine.slice(0, 24)}...` : firstLine || "新对话";
    }

    sessions.value.splice(index, 1);
    sessions.value.unshift(next);
  }

  async function loadSessions() {
    try {
      sessions.value = await invoke<Session[]>("cmd_list_sessions");
    } catch {
      sessions.value = [];
      currentSessionId.value = null;
      messages.value = [];
      setPersistedCurrentSessionId(null);
      return;
    }

    if (!sessions.value.length) {
      currentSessionId.value = null;
      messages.value = [];
      setPersistedCurrentSessionId(null);
      return;
    }

    const restoredId = getPersistedCurrentSessionId();
    const targetSession =
      sessions.value.find((session) => session.id === restoredId) ?? sessions.value[0];

    await selectSession(targetSession.id);
  }

  async function createSession() {
    const id = crypto.randomUUID();
    const now = Date.now();
    const session: Session = {
      id,
      title: "新对话",
      created_at: now,
      updated_at: now,
    };

    try {
      await invoke("cmd_create_session", { session });
      sessions.value.unshift(session);
      currentSessionId.value = id;
      messages.value = [];
      setPersistedCurrentSessionId(id);
    } catch (e) {
      console.error("Failed to create session:", e);
    }
  }

  async function selectSession(id: string) {
    currentSessionId.value = id;
    setPersistedCurrentSessionId(id);
    try {
      const persisted = await invoke<PersistedMessagePayload[]>("cmd_get_messages", {
        sessionId: id,
      });
      messages.value = persisted.map(deserializeMessage);
    } catch {
      messages.value = [];
    }
  }

  async function sendMessage(content: string) {
    if (!currentSessionId.value) {
      await createSession();
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      session_id: currentSessionId.value!,
      role: "user",
      content,
      timestamp: Date.now(),
    };

    messages.value.push(userMsg);
    updateLocalSession(userMsg.session_id, userMsg.timestamp, userMsg.content);
    flushPersistMessage(userMsg);

    const sidecar = useSidecarStore();
    const settings = useSettingsStore();
    sidecar.send("chat", {
      session_id: currentSessionId.value,
      content,
      provider: settings.defaultProvider,
      model: settings.defaultModel,
      base_url: settings.baseUrl || undefined,
      api_key: settings.apiKey || undefined,
    });

    return new Promise<void>((resolve) => {
      let assistantMsgId: string | null = null;
      const activeToolMsgIds = new Map<string, string>();

      function ensureAssistantMsg(): Message {
        if (!assistantMsgId) {
          assistantMsgId = crypto.randomUUID();
          const msg: Message = {
            id: assistantMsgId,
            session_id: currentSessionId.value!,
            role: "assistant",
            content: "",
            tool_calls: [],
            timestamp: Date.now(),
          };
          messages.value.push(msg);
          updateLocalSession(msg.session_id, msg.timestamp);
          queuePersistMessage(msg);
          return msg;
        }
        return messages.value.find((m) => m.id === assistantMsgId)!;
      }

      const off = sidecar.on("event", (data: unknown) => {
        const event = data as StreamEvent;

        if (event.type === "message_delta" && event.data?.content) {
          const msg = ensureAssistantMsg();
          msg.content += event.data.content;
          msg.timestamp = Date.now();
          updateLocalSession(msg.session_id, msg.timestamp);
          queuePersistMessage(msg);
        }

        if (event.type === "message" && event.data?.content && !assistantMsgId) {
          assistantMsgId = crypto.randomUUID();
          const assistantMsg: Message = {
            id: assistantMsgId,
            session_id: currentSessionId.value!,
            role: "assistant",
            content: event.data.content,
            timestamp: Date.now(),
          };
          messages.value.push(assistantMsg);
          updateLocalSession(assistantMsg.session_id, assistantMsg.timestamp);
          flushPersistMessage(assistantMsg);
        }

        if (event.type === "tool_execution_start" && event.data?.tool_name) {
          const toolId = crypto.randomUUID();
          const toolMsgId = crypto.randomUUID();
          activeToolMsgIds.set(event.data.tool_name + "_" + toolId, toolMsgId);

          const toolRecord: ToolCallRecord = {
            id: toolId,
            tool_name: event.data.tool_name,
            input: event.data.input,
            status: "running",
          };

          const toolMsg: Message = {
            id: toolMsgId,
            session_id: currentSessionId.value!,
            role: "tool",
            content: "",
            tool_calls: [toolRecord],
            timestamp: Date.now(),
          };
          messages.value.push(toolMsg);
          updateLocalSession(toolMsg.session_id, toolMsg.timestamp);
          flushPersistMessage(toolMsg);
        }

        if (event.type === "tool_execution_end" && event.data?.tool_name) {
          const toolMsg = [...messages.value]
            .reverse()
            .find(
              (m) =>
                m.role === "tool" &&
                m.tool_calls?.[0]?.tool_name === event.data.tool_name &&
                m.tool_calls?.[0]?.status === "running",
            );

          if (toolMsg?.tool_calls?.[0]) {
            toolMsg.tool_calls[0].output = event.data.output;
            toolMsg.tool_calls[0].status =
              event.data.status === "error" ? "error" : "success";
            toolMsg.timestamp = Date.now();
            updateLocalSession(toolMsg.session_id, toolMsg.timestamp);
            flushPersistMessage(toolMsg);
          }
        }

        if (event.type === "error" && (event.data?.content || event.data?.message)) {
          const errorText = event.data.content || event.data.message || "未知错误";
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            session_id: currentSessionId.value!,
            role: "assistant",
            content: `[错误] ${errorText}`,
            timestamp: Date.now(),
          };
          messages.value.push(errorMsg);
          updateLocalSession(errorMsg.session_id, errorMsg.timestamp);
          flushPersistMessage(errorMsg);
        }

        if (event.type === "agent_end") {
          const pendingAssistant = assistantMsgId
            ? messages.value.find((m) => m.id === assistantMsgId)
            : null;
          if (pendingAssistant) {
            flushPersistMessage(pendingAssistant);
          }
          for (const msg of messages.value.filter((m) => m.role === "tool")) {
            if (msg.session_id === currentSessionId.value) {
              flushPersistMessage(msg);
            }
          }
          off();
          resolve();
        }
      });
    });
  }

  function cancelCurrentRequest() {
    const sidecar = useSidecarStore();
    sidecar.send("cancel", { session_id: currentSessionId.value });
  }

  async function flushPersistence() {
    const pendingMessages = currentSessionId.value
      ? messages.value.filter((message) => message.session_id === currentSessionId.value)
      : [];

    for (const message of pendingMessages) {
      const existing = persistTimers.get(message.id);
      if (existing) {
        window.clearTimeout(existing);
        persistTimers.delete(message.id);
      }
      await persistMessage(message);
    }
  }

  return {
    sessions,
    currentSession,
    currentSessionId,
    messages,
    loadSessions,
    createSession,
    selectSession,
    sendMessage,
    cancelCurrentRequest,
    flushPersistence,
  };
});
