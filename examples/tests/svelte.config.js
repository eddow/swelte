import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from '@swelte/core/config';

/** @type {import('@swelte/core/config').SwelteConfig} */
export default defineConfig({
  preprocess: vitePreprocess(),
  // Client <await> (Svelte 5 experimental.async) lives here — NOT only in
  // vite.config.ts (language server reads this file directly, never vite's).
  compilerOptions: { experimental: { async: true } },
  swelte: {
    name: 'tests',
    routesDir: 'src/routes',
    libDir: 'src/lib',
    outDir: '.swelte',
    // Parity probe (P0 item 4): baked version stamp → X-Swelte-Version
    // header on every response (SWELTE_VERSION env wins when set).
    version: '9.9.9-test',
  },
});
