<script setup lang="ts">
import { ref, computed } from "vue";
import { useSessionStore } from "@/stores/session";
import { useSidecarStore } from "@/stores/sidecar";
import { useSettingsStore } from "@/stores/settings";

const session = useSessionStore();
const sidecar = useSidecarStore();
const settings = useSettingsStore();
const inputText = ref("");
const isStreaming = ref(false);

const settingsReady = computed(() => {
  if (["ollama", "vllm"].includes(settings.defaultProvider)) return true;
  return !!settings.apiKey;
});

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

function formatToolInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function formatToolOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    const str = JSON.stringify(output, null, 2);
    return str.length > 2000 ? str.slice(0, 2000) + "\n..." : str;
  } catch {
    return String(output);
  }
}

function toolStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "执行中...";
    case "success":
      return "完成";
    case "error":
      return "失败";
    default:
      return status;
  }
}
</script>

<template>
  <div class="chat-view">
    <div class="chat-header">
      <h2 class="chat-title">{{ session.currentSession?.title ?? "新对话" }}</h2>
    </div>

    <div class="chat-messages">
      <template v-for="msg in session.messages" :key="msg.id">
        <!-- Tool execution block -->
        <div v-if="msg.role === 'tool' && msg.tool_calls?.length" class="tool-block">
          <div
            v-for="tc in msg.tool_calls"
            :key="tc.id || tc.tool_name"
            :class="['tool-call', `tool-call--${tc.status}`]"
          >
            <div class="tool-call-header">
              <span class="tool-call-icon">{{ tc.status === 'running' ? '⟳' : tc.status === 'success' ? '✓' : '✗' }}</span>
              <span class="tool-call-name">{{ tc.tool_name }}</span>
              <span class="tool-call-status">{{ toolStatusLabel(tc.status) }}</span>
            </div>
            <details v-if="tc.input != null" class="tool-call-details">
              <summary>输入参数</summary>
              <pre class="tool-call-code">{{ formatToolInput(tc.input) }}</pre>
            </details>
            <details v-if="tc.output != null && tc.status !== 'running'" class="tool-call-details" open>
              <summary>执行结果</summary>
              <pre class="tool-call-code">{{ formatToolOutput(tc.output) }}</pre>
            </details>
          </div>
        </div>

        <!-- Regular message -->
        <div
          v-else
          :class="['message', `message--${msg.role}`]"
        >
          <div class="message-role">{{ msg.role === "user" ? "你" : "助手" }}</div>
          <div class="message-content">{{ msg.content }}</div>
        </div>
      </template>

      <div v-if="!sidecar.isReady" class="status-banner">
        正在启动 Agent 运行时...
      </div>
      <div v-else-if="!session.messages.length" class="status-banner">
        <template v-if="!settingsReady">
          请先前往 <router-link to="/settings" class="settings-link">设置</router-link> 配置 LLM Provider 和 API Key
        </template>
        <template v-else>
          开始新对话吧
        </template>
      </div>
    </div>

    <div class="chat-input-area">
      <textarea
        v-model="inputText"
        class="chat-input"
        :placeholder="sidecar.isReady ? '输入消息... (Enter 发送, Shift+Enter 换行)' : '正在连接 Agent 运行时...'"
        rows="3"
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

/* ── Tool execution blocks ── */

.tool-block {
  align-self: flex-start;
  max-width: 90%;
  width: 100%;
}

.tool-call {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 4px;
}

.tool-call--running {
  border-color: rgba(59, 130, 246, 0.3);
}

.tool-call--success {
  border-color: rgba(34, 197, 94, 0.2);
}

.tool-call--error {
  border-color: rgba(239, 68, 68, 0.3);
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.tool-call-icon {
  font-size: 14px;
  line-height: 1;
}

.tool-call--running .tool-call-icon {
  color: #3b82f6;
  animation: spin 1s linear infinite;
}

.tool-call--success .tool-call-icon {
  color: #22c55e;
}

.tool-call--error .tool-call-icon {
  color: #ef4444;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-call-name {
  font-weight: 600;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  color: rgba(255, 255, 255, 0.9);
}

.tool-call-status {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.5;
}

.tool-call-details {
  padding: 0;
}

.tool-call-details summary {
  padding: 6px 12px;
  font-size: 12px;
  opacity: 0.6;
  cursor: pointer;
  user-select: none;
}

.tool-call-details summary:hover {
  opacity: 0.8;
}

.tool-call-code {
  padding: 8px 12px;
  margin: 0;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.15);
  max-height: 300px;
  overflow-y: auto;
}

/* ── Status and input ── */

.status-banner {
  text-align: center;
  padding: 12px;
  font-size: 13px;
  opacity: 0.5;
}

.settings-link {
  color: var(--color-primary);
  text-decoration: underline;
  cursor: pointer;
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
