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
  // Client <await> (Svelte 5 experimental.async) needs this here — NOT only
  // in vite.config.ts. The VS Code Svelte extension / svelte-language-server
  // reads svelte.config.js directly and never sees vite.config.ts, so an
  // await in markup reports `experimental_async_missing` in the editor even
  // when `vite build` passes. vite.config.ts spreads this file, so the Vite
  // build picks it up from here too (its own merge is just a fallback).
  compilerOptions: { experimental: { async: true } },
  // Illustrative only — all defaults. defineConfig() keeps this key
  // non-enumerable: invisible to svelte() (no "invalid plugin options"
  // warning) but still readable by @swelte/core's loadConfig.
  swelte: {
    name: 'something',
    routesDir: 'src/routes',
    libDir: 'src/lib',
    outDir: '.swelte',
    // distDir: 'dist',
    // port: 8131, // V backend ($PORT wins)
    // corsOrigin: '', // e.g. 'https://example.com' or '*' ($SWELTE_CORS_ORIGIN wins)
  },
});
