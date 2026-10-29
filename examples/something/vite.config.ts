import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/core/vite';

export default defineConfig({
  plugins: [
    svelte(),
    swelte({
      vBackendUrl: 'http://localhost:8132',
      routesDir: 'src/routes',
      libDir: 'src/lib',
    }),
  ],
});
