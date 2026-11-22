# `@swelte/plus` — jobs scheduler plugin (`@[cron]`)

Explicit registration — no builtins. DB/rooms/`migrate` stay core builtins
until §3 boxes 2–3 move them here.

```ts
import { jobsPlugin, createJobsPlugin } from '@swelte/plus'; // or '@swelte/plus/jobs'
import { swelte } from '@swelte/core/vite';

export default defineConfig({
  plugins: [svelte(svelteConfig), swelte({ plugins: [jobsPlugin] })],
});
```

- `@[cron('60s')]` / `@[cron('5m,retry=3')]` in `src/app.v` — without the
  plugin the attr stays inert (core parses it only via the plugin's
  `attrs`); with it, one scheduler thread starts after app startup.
- `createJobsPlugin({ durable: true })` opts the scheduler into SQLite
  schedule persistence / restart catchup (`SWELTE_JOBS_PATH`, ships
  `vlib/sweltejobs`).
- Rooms/WS still ride the builtin backend hub (no plugin needed) until
  box 3 moves them here.

V lesson (kept): DDL/DML need `exec_none` (`!= 101`); `exec()` only steps row queries.
