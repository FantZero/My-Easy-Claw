import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useSidecarStore } from "./sidecar";
import type { Session, Message } from "@my-easy-claw/shared";

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
    sidecar.send("chat", {
      session_id: currentSessionId.value,
      content,
    });

    return new Promise<void>((resolve) => {
      const off = sidecar.on("event", (data: unknown) => {
        const event = data as { type: string; data: { content?: string } };
        if (event.type === "message" && event.data?.content) {
          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            session_id: currentSessionId.value!,
            role: "assistant",
            content: event.data.content,
            timestamp: Date.now(),
          };
          messages.value.push(assistantMsg);
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
