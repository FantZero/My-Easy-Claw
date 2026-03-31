<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useSessionStore } from "@/stores/session";
import { useSidecarStore } from "@/stores/sidecar";
import type { AgentEvent } from "@my-easy-claw/shared";

const session = useSessionStore();
const sidecar = useSidecarStore();
const inputText = ref("");
const isStreaming = ref(false);

function handleSend() {
  const content = inputText.value.trim();
  if (!content || isStreaming.value || !sidecar.isReady) return;

  isStreaming.value = true;
  inputText.value = "";
  session.sendMessage(content).finally(() => {
    isStreaming.value = false;
  });
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function handleCancel() {
  session.cancelCurrentRequest();
  isStreaming.value = false;
}
</script>

<template>
  <div class="chat-view">
    <div class="chat-header">
      <h2 class="chat-title">{{ session.currentSession?.title ?? "新对话" }}</h2>
    </div>

    <div class="chat-messages">
      <div
        v-for="msg in session.messages"
        :key="msg.id"
        :class="['message', `message--${msg.role}`]"
      >
        <div class="message-role">{{ msg.role === "user" ? "你" : "助手" }}</div>
        <div class="message-content">{{ msg.content }}</div>
      </div>

      <div v-if="!sidecar.isReady" class="status-banner">
        正在启动 Agent 运行时...
      </div>
    </div>

    <div class="chat-input-area">
      <textarea
        v-model="inputText"
        class="chat-input"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        rows="3"
        :disabled="!sidecar.isReady"
        @keydown="handleKeydown"
      />
      <div class="chat-actions">
        <button
          v-if="isStreaming"
          class="btn btn-cancel"
          @click="handleCancel"
        >
          停止
        </button>
        <button
          v-else
          class="btn btn-send"
          :disabled="!inputText.trim() || !sidecar.isReady"
          @click="handleSend"
        >
          发送
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.chat-title {
  font-size: 15px;
  font-weight: 500;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.6;
}

.message--user {
  align-self: flex-end;
  background: var(--color-primary);
  color: #fff;
}

.message--assistant {
  align-self: flex-start;
  background: var(--color-surface);
}

.message-role {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.message-content {
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

.status-banner {
  text-align: center;
  padding: 12px;
  font-size: 13px;
  opacity: 0.5;
}

.chat-input-area {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  resize: none;
  background: var(--color-surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 10px 14px;
  color: var(--color-text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.chat-input:focus {
  border-color: var(--color-primary);
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-send {
  background: var(--color-primary);
  color: #fff;
}

.btn-cancel {
  background: #dc2626;
  color: #fff;
}
</style>
