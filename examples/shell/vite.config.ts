import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/ssr-qjs';
import { toolsPlugin } from '@swelte/ai/tools';
import { dbPlugin } from '@swelte/plus/db';
import { roomsPlugin } from '@swelte/plus/rooms';
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
    tailwindcss(),
    svelte(svelteOptions as Parameters<typeof svelte>[0]),
    swelte({
      vBackendUrl,
      // Explicit framework extensions: the AI tools plugin claims `@[tool]`
      // and generates `.swelte/tools/`; the Plus rooms plugin claims
      // room-mode `@[sse]` (shell stream); the Plus db plugin stages the
      // KV/SQLite backend (`backend/db.v`) the shell approvals, stdin queue
      // and scrollback persist in. Jobs + DB migrations beyond the KV table
      // live in `@swelte/plus` — add `jobsPlugin` here when the shell needs it.
      plugins: [toolsPlugin, dbPlugin, roomsPlugin],
    }),
  ],
});
