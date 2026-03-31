import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "chat",
      components: {
        default: () => import("@/views/ChatView.vue"),
        sidebar: () => import("@/views/SessionList.vue"),
      },
    },
    {
      path: "/settings",
      name: "settings",
      components: {
        default: () => import("@/views/SettingsView.vue"),
        sidebar: () => import("@/views/SessionList.vue"),
      },
    },
  ],
});
