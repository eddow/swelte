import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/ssr-qjs';
// Room/WS e2e needs the Plus rooms plugin (explicit registration).
import { roomsPlugin } from '@swelte/plus/rooms';
import svelteConfig from './svelte.config.js';

const vBackendUrl =
  process.env.SWELTE_V_BACKEND_URL ??
  process.env.VITE_SWELTE_V_BACKEND_URL ??
  'http://localhost:8131';

const svelteOptions = {
  ...svelteConfig,
  compilerOptions: { ...((svelteConfig as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {}), experimental: { ...((((svelteConfig as { compilerOptions?: { experimental?: Record<string, unknown> } }).compilerOptions ?? {}).experimental ?? {}) as Record<string, unknown>), async: true } },
};

export default defineConfig({
  plugins: [
    svelte(svelteOptions as Parameters<typeof svelte>[0]),
    swelte({
      vBackendUrl,
      // Room-hub e2e (ws-rooms/ws-echo) — explicit Plus registration.
      plugins: [roomsPlugin],
    }),
  ],
});
