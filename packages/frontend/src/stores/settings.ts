import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { LLMProvider } from "@my-easy-claw/shared";

interface ProviderUpdate {
  provider: LLMProvider;
  model: string;
  base_url?: string;
}

export const useSettingsStore = defineStore("settings", () => {
  const defaultProvider = ref<LLMProvider>("openai");
  const defaultModel = ref("gpt-4o");
  const baseUrl = ref("");

  async function loadSettings() {
    try {
      const config = await invoke<ProviderUpdate>("db_get_default_provider");
      if (config) {
        defaultProvider.value = config.provider;
        defaultModel.value = config.model;
        baseUrl.value = config.base_url ?? "";
      }
    } catch {
      // use defaults
    }
  }

  async function updateProvider(update: ProviderUpdate) {
    defaultProvider.value = update.provider;
    defaultModel.value = update.model;
    baseUrl.value = update.base_url ?? "";

    try {
      await invoke("db_set_default_provider", { config: update });
    } catch (e) {
      console.error("Failed to save provider settings:", e);
    }
  }

  return {
    defaultProvider,
    defaultModel,
    baseUrl,
    loadSettings,
    updateProvider,
  };
});
