import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useSidecarStore } from "./sidecar";
import { useSettingsStore } from "./settings";
import type { Session, Message, ToolCallRecord } from "@my-easy-claw/shared";

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

export const useSessionStore = defineStore("session", () => {
  const sessions = ref<Session[]>([]);
  const currentSessionId = ref<string | null>(null);
  const messages = ref<Message[]>([]);

  const currentSession = computed(() =>
    sessions.value.find((s) => s.id === currentSessionId.value) ?? null,
  );

  async function loadSessions() {
    try {
      sessions.value = await invoke<Session[]>("db_list_sessions");
    } catch {
      sessions.value = [];
    }
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
      await invoke("db_create_session", { session });
      sessions.value.unshift(session);
      currentSessionId.value = id;
      messages.value = [];
    } catch (e) {
      console.error("Failed to create session:", e);
    }
  }

  async function selectSession(id: string) {
    currentSessionId.value = id;
    try {
      messages.value = await invoke<Message[]>("db_get_messages", {
        sessionId: id,
      });
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
          return msg;
        }
        return messages.value.find((m) => m.id === assistantMsgId)!;
      }

      const off = sidecar.on("event", (data: unknown) => {
        const event = data as StreamEvent;

        if (event.type === "message_delta" && event.data?.content) {
          const msg = ensureAssistantMsg();
          msg.content += event.data.content;
        }

        if (event.type === "message" && event.data?.content && !assistantMsgId) {
          assistantMsgId = crypto.randomUUID();
          messages.value.push({
            id: assistantMsgId,
            session_id: currentSessionId.value!,
            role: "assistant",
            content: event.data.content,
            timestamp: Date.now(),
          });
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

          messages.value.push({
            id: toolMsgId,
            session_id: currentSessionId.value!,
            role: "tool",
            content: "",
            tool_calls: [toolRecord],
            timestamp: Date.now(),
          });
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
          }
        }

        if (event.type === "error" && (event.data?.content || event.data?.message)) {
          const errorText = event.data.content || event.data.message || "未知错误";
          messages.value.push({
            id: crypto.randomUUID(),
            session_id: currentSessionId.value!,
            role: "assistant",
            content: `[错误] ${errorText}`,
            timestamp: Date.now(),
          });
        }

        if (event.type === "agent_end") {
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
  };
});
