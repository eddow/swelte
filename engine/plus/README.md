# `@swelte/plus` — jobs scheduler + embedded SQLite/KV backend plugins

Explicit registration — no builtins. SQLite/KV + `migrate` live here since
§3 box 2 (`dbPlugin`); rooms/hub + `@[ws]`/room-SSE dispatch live here since
§3 box 3 (`roomsPlugin`).

```ts
import { jobsPlugin, createJobsPlugin, dbPlugin, roomsPlugin } from '@swelte/plus'; // or '@swelte/plus/jobs', '@swelte/plus/db', '@swelte/plus/rooms'
import { swelte } from '@swelte/core/vite';

export default defineConfig({
  plugins: [svelte(svelteConfig), swelte({ plugins: [jobsPlugin, dbPlugin, roomsPlugin] })],
});
```

- `@[cron('60s')]` / `@[cron('5m,retry=3')]` in `src/app.v` — without the
  plugin the attr stays inert (core parses it only via the plugin's
  `attrs`); with it, one scheduler thread starts after app startup.
- `createJobsPlugin({ durable: true })` opts the scheduler into SQLite
  schedule persistence / restart catchup (`SWELTE_JOBS_PATH`, ships
  `vlib/sweltejobs`).
- `dbPlugin` stages `backend/db.v` (KV/SQLite) into `.swelte/` whenever
  registered; `swelte migrate` scaffolds `src/lib/backend/db.v` +
  `db/migrations/001_swelte_kv.sql` and applies `db/migrations/*.sql`
  (tracked in `_swelte_migrations`, idempotent).
- `roomsPlugin` (`@[ws]` + room-mode `@[sse]`) stages `backend/{hub,ws}.v`
  (room hub + WS framing) into `.swelte/` whenever registered. Core stages
  no backend V modules; room/WS fns without the plugin are build errors.

V lesson (kept): DDL/DML need `exec_none` (`!= 101`); `exec()` only steps row queries.
