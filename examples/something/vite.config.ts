import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/core/vite';

const vBackendUrl =
  process.env.SWELTE_V_BACKEND_URL ??
  process.env.VITE_SWELTE_V_BACKEND_URL ??
  'http://localhost:8131';

export default defineConfig({
  plugins: [
    svelte(),
    swelte({
      vBackendUrl,
      routesDir: 'src/routes',
      libDir: 'src/lib',
    }),
  ],
});
