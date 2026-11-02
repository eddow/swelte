import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/ssr-qjs';
import svelteConfig from './svelte.config.js';

const vBackendUrl =
  process.env.SWELTE_V_BACKEND_URL ??
  process.env.VITE_SWELTE_V_BACKEND_URL ??
  'http://localhost:8131';

// section 1.3 streaming: client <await> needs Svelte experimental.async.
// The SSR bundle is composed by adapters (generate:'server', always sync),
// so this flag never reaches sync renderRoute.
const svelteOptions = {
  ...svelteConfig,
  compilerOptions: { ...((svelteConfig as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {}), experimental: { ...((((svelteConfig as { compilerOptions?: { experimental?: Record<string, unknown> } }).compilerOptions ?? {}).experimental ?? {}) as Record<string, unknown>), async: true } },
};

export default defineConfig({
  plugins: [
    svelte(svelteOptions as Parameters<typeof svelte>[0]),
    // Dirs come from svelte.config.js `swelte` key; plugin falls back to
    // the unified config for any option not passed here.
    swelte({
      vBackendUrl,
    }),
  ],
});
