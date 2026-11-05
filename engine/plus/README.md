# `@swelte/plus` — beyond-SvelteKit plugins

Optional package. Core stays parity-only (byte-identical output without
plugins); plus owns attrs core never names. Today: `jobs` (scheduled
`@[cron]` ticks) + `db` (embedded SQLite/KV).

```sh
npm install @swelte/plus
```

```ts
// vite.config.ts — both plugins ride the same SweltePlugin contract
import { swelte } from '@swelte/ssr-qjs';
import { jobsPlugin, dbPlugin } from '@swelte/plus';

export default defineConfig({
  plugins: [svelte(svelteConfig), swelte({ vBackendUrl, plugins: [jobsPlugin, dbPlugin] })],
});
```

- **jobs** — `@[cron('60s')]` / `@[cron('5m,retry=3')]` in `src/app.v`.
  Single scheduler thread at boot (no CLI/SSH), console tick log.
- **db** — `swelte migrate` via `SWELTE_PLUGINS=@swelte/plus/db`.
  Scaffolds `src/lib/backend/db.v` (shared conn + `kv_get/kv_set/kv_del`)
  + `db/migrations/001_swelte_kv.sql`; applies pendings in order,
  tracked in `_swelte_migrations`. Routes `import backend` — core copies
  `vlib/backend/*.v` into `.swelte/` at generate (see `includes`).

Full docs: `docs/plus.md`, `docs/cli.md` (`swelte migrate`), `docs/specs/future.md` items 1–2.
V lesson: DDL/DML need `exec_none` (`!= 101`); `exec()` only steps row queries.
