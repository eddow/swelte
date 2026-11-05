# Plus (`@swelte/plus`) — beyond-SvelteKit plugins

Optional package. Core stays parity-only (byte-identical output without
plugins); plus owns attrs core never names. Today: `jobs` (scheduled
`@[cron]` ticks — [future.md](specs/future.md) item 1) + `db` (embedded
SQLite/KV — [future.md](specs/future.md) item 2).

```sh
npm install @swelte/plus
```

```ts
// vite.config.ts
import { swelte } from '@swelte/ssr-qjs';
import { jobsPlugin, dbPlugin } from '@swelte/plus'; // or '@swelte/plus/jobs', '@swelte/plus/db'

export default defineConfig({
  plugins: [svelte(svelteConfig), swelte({ vBackendUrl, plugins: [jobsPlugin, dbPlugin] })],
});
```

Without a plugin, its surface is a build error (`@[cron]` unknown attr;
`import backend` unresolvable in generated routes). With it, `src/app.v`
may hold one-or-more tick fns and `#routes/*.v` may `import backend`.
`db` additionally contributes its V module dir to the `.swelte/`
compilation unit (see `includes` below), so no manual wiring is needed.
No CLI from jobs (ticks start at boot in the container); `db` adds
`swelte migrate` (see `cli`).

## `@[cron]` ticks

```v
module app

@[cron('60s')]
pub fn tick() {
	println('every minute')
}

@[cron('5m,retry=3')]
pub fn sweep() !void {
	// fallible: may throw, retried 3x with 5s-linear backoff
}
```

Rules:

- **Location:** `src/app.v` only (route files → `only allowed in src/app.v`).
- **Qualifier:** `'<duration>[,retry=n]'` — duration is digits + `s|m|h`,
  nonzero (`'60s'`, `'5m'`, `'1h'`); whitespace around the comma tolerated.
- **Retry:** `retry=1..5`, fallible (`!void`) fns only. `void` + retry is a
  file+line build error (nothing can fail, so nothing to retry).
- **Params/return:** no params, `void` / `!void` only.
- **Bodies:** must be idempotent — single-instance best-effort, no watchdog,
  and missed ticks coalesce (never a catch-up burst).

## Console log schema

All tick outcomes go to the console (stderr) — no log file by design
(container-native: collected by Railway/docker logs, `grep`-able):

```text
[swelte:cron] tick=tick status=catchup lag=130s   # wake-up behind >= 2 intervals, fires once
[swelte:cron] tick=sweep status=retry attempt=0 err=<msg>
[swelte:cron] tick=sweep status=retry attempt=1 err=<msg>
[swelte:cron] tick=sweep status=ok attempt=2       # recovered
[swelte:cron] tick=sweep status=dead attempt=3 err=<msg>  # exhausted
[swelte:cron] tick=sweep status=error err=<msg>    # fallible, no retry
```

First-try success stays silent. Status reference:

| status | when |
|---|---|
| _(none)_ | first-try success — silent, zero log spam |
| `retry` | attempt failed, sleeping `(attempt+1) * 5s` then retrying |
| `ok` | recovered on `attempt=N` (only logged when N > 0) |
| `dead` | all `retry=N` attempts failed — dead-letter |
| `error` | fallible tick failed, no `retry=` configured |
| `catchup` | scheduler woke behind `>= 2 * every`, fires once then resumes |

## How it works

`loadAppHooks` reads `src/app.v`, validates every `@[cron]` fn, and emits
two fragments into the V harness (before `mut app := &App{}`):

- `main`: top-level `swelte_cron_N` fns (user bodies verbatim, so fallible
  fns compile) + `swelte_cron_run()` — the ONE scheduler thread.
- `mainInner`: `// @[cron]` header + `spawn swelte_cron_run()`.

The scheduler holds a `next[i]` unix deadline per tick, sleeps to the
nearest one (idle = one sleeping thread, zero wakeups/CPU), fires due
ticks, and advances `next[i] = now + every`. Retries run a **blocking**
linear-backoff loop inside the tick's arm — the scheduler thread is
preserved, but a retrying tick may briefly delay other ticks (cap 5 bounds
this to ~75s worst case).

Zero ticks → empty fragments: harness byte-identical to parity output.

## Limits (by design)

- Single-instance best-effort: two containers = two schedulers (no
  distributed lock).
- No persistence yet: tick log is console-only; cross-restart catchup is
  future work (see [future.md](specs/future.md) item 1).
- No cron-expression parser in v1 — duration literal only.

## Helpers

Pure-TS, importable without codegen (pinned by plus unit tests):

```ts
import { plusCronSeconds, plusCronParse, PLUS_CRON_MAX_RETRY, PLUS_CRON_RETRY_STEP_S } from '@swelte/plus';

plusCronSeconds('5m'); // 300
plusCronParse('5m,retry=3'); // { seconds: 300, retry: 3 }
```

## `db` — embedded SQLite/KV

```v
module app

// src/lib/backend/db.v (scaffolded by `swelte migrate`, backend-only)
import backend

@[get]
pub fn visits(req SwelteRequest) string {
	backend.kv_set('visits', 'seen')!
	return backend.kv_get('visits')!
}
```

Single SQLite file (WAL mode, `SWELTE_DB_PATH` env else `data/app.db`).
`swelte migrate` (via `SWELTE_PLUGINS=@swelte/plus/db`) scaffolds
`src/lib/backend/db.v` + `db/migrations/001_swelte_kv.sql` on first run,
then applies `db/migrations/*.sql` in filename order (tracked in
`_swelte_migrations`, idempotent re-runs). Migrations are raw SQL;
app tables are yours. The `swelte_kv` table doubles as the primitive for
SSE rooms / SWR regen state / offline outbox (future items 4/5/7).

Rules:

- **Location:** `src/lib/backend/db.v` (or `*_backend.v`) — backend-only,
  importable from `#routes/*.v` at codegen time, never from the browser.
- **DDL/DML use `exec_none`** (`!= 101` is failure): V's `db.sqlite`
  `exec()` only steps row queries — INSERT/CREATE silently no-op through
  it. SELECTs use `exec()` + `Row.get_string/get_int`.
- **Helpers:** `plusDbPath(root, env?)`, `plusPendingMigrations(root,
  applied)` — pure-TS, pinned by plus unit tests.
- **`includes` (plugin → `.swelte/` wiring):** `dbPlugin.includes()`
  contributes `[{ module: 'backend', absDir: '<pkg>/vlib/backend' }]`.
  Core's `generate()` copies each include's `*.v` into
  `.swelte/<module>/`, so generated routes resolve `import backend`
  with no manual wiring. Missing dirs are skipped (TS-only install);
  stale module dirs are pruned; `routes`/`main` names are reserved.
  The copy (and `.swelte/plugin_modules.json` marker) is pinned by
  core's `codegen-shape` tests.

## Bridge stub + dangling-bridge heal (core)

`swelte dev` compiles `.swelte/` directly, so the harness must resolve
`routes.swelte_qjs_render_page` even with no adapter. Core's
`generate()` writes a no-op stub (`routes/swelte_qjs_bridge.v`, returns
not-ok → Hand falls back to the sidecar proxy / SPA shell) when no
bridge exists; the adapter overwrites it with the real bridge during
`swelte build` (generateBundle), and core never clobbers a real bridge.
`dev` also self-heals a DANGLE bridge — real bridge whose `#flag`ed
`libqjs.a` is missing (e.g. `.swelte/qjs/` cleaned without a rebuild):
it deletes the bridge so the next generate writes the stub, and logs
that dev uses sidecar SSR until the next `swelte build`. `build` stays
strict (a missing archive there is a real build bug).
