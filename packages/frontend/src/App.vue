<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useSidecarStore } from "@/stores/sidecar";
import { useSettingsStore } from "@/stores/settings";
import { useSessionStore } from "@/stores/session";

const sidecar = useSidecarStore();
const settings = useSettingsStore();
const session = useSessionStore();

function flushSessionPersistence() {
  void session.flushPersistence();
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    flushSessionPersistence();
  }
}

onMounted(() => {
  sidecar.init();
  settings.loadSettings();
  void session.loadSessions();
  window.addEventListener("beforeunload", flushSessionPersistence);
  window.addEventListener("pagehide", flushSessionPersistence);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onUnmounted(() => {
  flushSessionPersistence();
  sidecar.cleanup();
  window.removeEventListener("beforeunload", flushSessionPersistence);
  window.removeEventListener("pagehide", flushSessionPersistence);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h1 class="app-title">Easy Claw</h1>
      </div>
      <router-view name="sidebar" />
    </aside>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
}

.sidebar {
  width: 260px;
  min-width: 260px;
  background: var(--color-surface);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 20px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.app-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
