import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/ssr-qjs';
import { jobsPlugin, sseChannelsPlugin, swrPlugin, outboxPlugin } from '@swelte/plus';
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
      // V+TS plugins (core contract, implemented by @swelte/plus):
      // parity-only output when absent; extensions active when listed.
      plugins: [jobsPlugin, sseChannelsPlugin, swrPlugin, outboxPlugin],
    }),
  ],
});
