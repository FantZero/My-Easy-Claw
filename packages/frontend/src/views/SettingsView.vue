<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import type { LLMProvider } from "@my-easy-claw/shared";

const router = useRouter();
const settings = useSettingsStore();

const provider = ref<LLMProvider>(settings.defaultProvider);
const model = ref(settings.defaultModel);
const baseUrl = ref(settings.baseUrl);

function save() {
  settings.updateProvider({
    provider: provider.value,
    model: model.value,
    base_url: baseUrl.value || undefined,
  });
  router.push("/");
}
</script>

<template>
  <div class="settings-view">
    <div class="settings-header">
      <h2>设置</h2>
    </div>

    <div class="settings-content">
      <section class="settings-section">
        <h3>LLM Provider</h3>

        <label class="field">
          <span class="field-label">Provider</span>
          <select v-model="provider" class="field-input">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
            <option value="ollama">Ollama</option>
            <option value="vllm">vLLM</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Model</span>
          <input v-model="model" class="field-input" placeholder="e.g. gpt-4o" />
        </label>

        <label class="field">
          <span class="field-label">Base URL (可选)</span>
          <input v-model="baseUrl" class="field-input" placeholder="https://..." />
        </label>
      </section>

      <button class="btn btn-save" @click="save">保存</button>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow-y: auto;
}

.settings-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.settings-header h2 {
  font-size: 15px;
  font-weight: 500;
}

.settings-content {
  padding: 24px 20px;
  max-width: 560px;
}

.settings-section {
  margin-bottom: 32px;
}

.settings-section h3 {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.5;
  margin-bottom: 16px;
}

.field {
  display: block;
  margin-bottom: 16px;
}

.field-label {
  display: block;
  font-size: 13px;
  margin-bottom: 6px;
  opacity: 0.7;
}

.field-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--color-surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--color-text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

.field-input:focus {
  border-color: var(--color-primary);
}

select.field-input {
  cursor: pointer;
}

.btn-save {
  padding: 10px 28px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
</style>
