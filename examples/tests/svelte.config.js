import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from '@swelte/core/config';

/** @type {import('@swelte/core/config').SwelteConfig} */
export default defineConfig({
  preprocess: vitePreprocess(),
  swelte: {
    name: 'tests',
    routesDir: 'src/routes',
    libDir: 'src/lib',
    outDir: '.swelte',
  },
});
