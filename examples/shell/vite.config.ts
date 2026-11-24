import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    {
      name: 'shell-source-revision',
      resolveId(id) { if (id === 'virtual:shell-revision') return '\0shell-revision'; },
      load(id) {
        if (id !== '\0shell-revision') return;
        const source = (path: string) => { const file = fileURLToPath(new URL(path, import.meta.url)); return readFileSync(file, 'utf8'); };
        const hash = (paths: string[]) => createHash('sha256').update(paths.map(source).join('\n')).digest('hex');
        return `export const expectedBackendRevision = ${JSON.stringify(hash(['./src/routes/+page.v','./src/lib/backend/shell_tools.v','./src/lib/backend/shell_fs.v']))}; export const uiRevision = ${JSON.stringify(hash(['./src/routes/+page.svelte','./src/lib/shell.ts','./src/lib/ai-answer.svelte']))};`;
      },
      configureServer(server) {
        const files = ['./src/routes/+page.v', './src/lib/backend/shell_tools.v', './src/lib/backend/shell_fs.v'].map(path => fileURLToPath(new URL(path, import.meta.url)));
        server.watcher.add(files);
        const changed = (file: string) => {
          if (!files.includes(file)) return;
          const mod = server.moduleGraph.getModuleById('\0shell-revision');
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        };
        server.watcher.on('change', changed);
        server.httpServer?.once('close', () => server.watcher.off('change', changed));
      },
      handleHotUpdate(ctx) {
        const mod = ctx.server.moduleGraph.getModuleById('\0shell-revision');
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
        if (ctx.file.endsWith('.v')) ctx.server.ws.send({ type: 'full-reload' });
      },
    },
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
