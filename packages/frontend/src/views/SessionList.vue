<script setup lang="ts">
import { useSessionStore } from "@/stores/session";
import { useRouter } from "vue-router";

const session = useSessionStore();
const router = useRouter();

function createNewSession() {
  session.createSession();
}

function selectSession(id: string) {
  session.selectSession(id);
  router.push("/");
}

function openSettings() {
  router.push("/settings");
}
</script>

<template>
  <div class="session-list">
    <button class="new-session-btn" @click="createNewSession">
      + 新对话
    </button>

    <div class="sessions">
      <div
        v-for="s in session.sessions"
        :key="s.id"
        :class="['session-item', { active: s.id === session.currentSession?.id }]"
        @click="selectSession(s.id)"
      >
        <span class="session-title">{{ s.title }}</span>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="settings-btn" @click="openSettings">
        设置
      </button>
    </div>
  </div>
</template>

<style scoped>
.session-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.new-session-btn {
  margin: 12px;
  padding: 10px;
  background: rgba(99, 102, 241, 0.15);
  color: var(--color-primary);
  border: 1px dashed rgba(99, 102, 241, 0.3);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s;
}

.new-session-btn:hover {
  background: rgba(99, 102, 241, 0.25);
}

.sessions {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

.session-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.1s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.session-item.active {
  background: rgba(99, 102, 241, 0.15);
  color: var(--color-primary);
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.settings-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--color-text);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}

.settings-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}
</style>
