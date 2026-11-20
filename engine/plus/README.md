# `@swelte/plus` — DEPRECATED (now part of core)

Jobs (`@[cron]`) + embedded backend (SQLite/KV, broadcast hub, WS framing,
`swelte migrate`) moved into `@swelte/core` — always builtin, no install,
no `plugins: [...]` entry needed.

This package is an empty re-export shim so existing setups keep resolving:

```ts
import { jobsPlugin, dbPlugin, createJobsPlugin } from '@swelte/plus'; // still works
import { jobsPlugin, dbPlugin, createJobsPlugin } from '@swelte/core'; // preferred
```

- `@[cron('60s')]` / `@[cron('5m,retry=3')]` in `src/app.v` — zero ticks emit
  empty harness fragments (byte-identical).
- `swelte migrate` is a core command now (`SWELTE_PLUGINS` override unneeded).
- `createJobsPlugin({ durable: true })` still opts the scheduler into SQLite
  schedule persistence / restart catchup (`SWELTE_JOBS_PATH`).
- Rooms/WS ride the builtin backend hub (no plugin needed).

V lesson (kept): DDL/DML need `exec_none` (`!= 101`); `exec()` only steps row queries.
