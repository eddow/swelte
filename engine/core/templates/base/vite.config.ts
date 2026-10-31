import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/core/vite';
import svelteConfig from './svelte.config.js';

const vBackendUrl =
  process.env.SWELTE_V_BACKEND_URL ??
  process.env.VITE_SWELTE_V_BACKEND_URL ??
  'http://localhost:8131';

export default defineConfig({
  plugins: [
    svelte(svelteConfig),
    // Dirs come from svelte.config.js `swelte` key; plugin falls back to
    // the unified config for any option not passed here.
    swelte({
      vBackendUrl,
    }),
  ],
});
