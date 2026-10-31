import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from '@swelte/core/config';

/** @type {import('@swelte/core/config').SwelteConfig} */
export default defineConfig({
  // Required by the VS Code Svelte extension (svelte-language-server) to
  // preprocess <script lang="ts"> blocks. Without this file the extension
  // falls back to loading vite.config.ts via @sveltejs/load-config, which
  // currently looks for a plugin named 'vite-plugin-svelte:config' while the
  // installed @sveltejs/vite-plugin-svelte@5 exposes 'vite-plugin-svelte' —
  // hence "No Svelte configuration found in vite config".
  // See: node_modules/@sveltejs/vite-plugin-svelte/src/index.js (name) vs
  // ~/.vscode/extensions/svelte.svelte-vscode-*/node_modules/@sveltejs/load-config/dist/src/index.js
  preprocess: vitePreprocess(),
  swelte: {
    name: '__NAME__',
    routesDir: 'src/routes',
    libDir: 'src/lib',
    outDir: '.swelte',
    // distDir: 'dist',
    // port: 8131, // V backend ($PORT wins)
    // corsOrigin: '', // e.g. 'https://example.com' or '*' ($SWELTE_CORS_ORIGIN wins)
  },
});
