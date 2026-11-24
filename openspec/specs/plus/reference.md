# Plus — jobs scheduler + embedded DB + rooms plugins (`@[cron]`, `migrate`, `@[ws]`/room-SSE live in `@swelte/plus`)

> Detailed reference for the [capability contract](spec.md). Implementation
> notes and measurements describe their stated scope, not additional guarantees.

> `@swelte/plus` owns `jobs` (`@[cron]`, incl. durable scheduling), `db`
> (embedded SQLite/KV + `swelte migrate`) and `rooms` (room hub +
> `@[ws]`/room-mode-`@[sse]` dispatch) as explicit
> `swelte({ plugins: [...] })` registrations. Core keeps the HTTP verbs,
> plain SSE (list/emit) and the WS *transport* (upgrade handshake, socket
> pump, `__swelteWsUrl` client URL builder); the hub, room dispatch and
> socket-open wiring arrive only with the rooms plugin.
> Reference below is kept — shapes and runtime semantics are unchanged.

```ts
// vite.config.ts — register the Plus plugins explicitly
import { jobsPlugin, dbPlugin, roomsPlugin } from '@swelte/plus';
import { swelte } from '@swelte/core/vite';

export default defineConfig({
  plugins: [svelte(svelteConfig), swelte({ plugins: [jobsPlugin, dbPlugin, roomsPlugin] })],
});
```

`src/app.v` may hold one-or-more `@[cron]` tick fns (inert without the
plugin); `#routes/*.v` may `import backend` (SQLite/KV via `db.v`, room-SSE/WS
via the hub). The Plus `db` plugin stages `backend/db.v` into `.swelte/`
whenever registered; the Plus `rooms` plugin stages `backend/{hub,ws}.v`
whenever registered (unused hub copies nothing; remove the plugin and the
staged dir prunes). Core stages no backend V modules itself. `swelte migrate`
is a Plus command (see `cli`); ticks start at boot in the container (no CLI/SSH).
Room/WS fns without the rooms plugin are build errors naming the fix.

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
[swelte:cron] tick=sweep status=retry attempt=0 reason=failed
[swelte:cron] tick=sweep status=retry attempt=1 reason=failed
[swelte:cron] tick=sweep status=ok attempt=2       # recovered
[swelte:cron] tick=sweep status=dead attempt=3 reason=failed  # exhausted
[swelte:cron] tick=sweep status=error reason=failed    # fallible, no retry
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
two fragments into the V harness. Plugin jobs start after app startup succeeds:

- `main`: top-level `swelte_cron_N` fns (user bodies verbatim, so fallible
  fns compile) + `swelte_cron_run(lifecycle)` — the ONE scheduler thread.
- `mainInner`: starts the tracked scheduler with `app.lifecycle`.

The scheduler holds a `next[i]` unix deadline per tick, sleeps to the
nearest one (idle = one sleeping thread, zero wakeups/CPU), fires due
ticks, and advances `next[i] = now + every`. Retries run a **blocking**
linear-backoff loop inside the tick's arm — the scheduler thread is
preserved, but a retrying tick may briefly delay other ticks (cap 5 bounds
this to ~75s worst case).
Sleeps/backoff stop on shutdown, while an executing tick remains tracked until
it returns. The shutdown hook runs after tracked work drains. Original failure
messages go to the optional server-side `@[report]` hook as `job-error` events;
console diagnostics use generic reasons. See [lifecycle](../native-lifecycle/reference.md).

Zero ticks → no cron loops: core stays inert without the plugin.

## Durable schedules

Use the factory to opt in, keeping the same `@[cron]` functions:

```ts
import { createJobsPlugin } from '@swelte/plus'
const jobs = createJobsPlugin({ durable: true })
// Include jobs in swelte({ plugins: [jobs, ...] }).
```

`SWELTE_JOBS_PATH` selects a separate SQLite file (default `data/jobs.db`).
All cooperating instances must use that same file and the same job names and
intervals. It is independent of the embedded backend database and the application's data database.
The jobs plugin stages its own native module; SQLite development dependencies
are needed to build a durable worker.

A job name is its persistent identity. First registration schedules it one
interval ahead. Each worker polls once a second. An exclusive SQLite transaction
spans a due job and its retries, so cooperating processes serialize execution.
Successful or exhausted execution commits `next_run = completion + interval`,
`last_run`, and `last_status` (`ok` or `failed`) to `swelte_jobs`. Overdue intervals
coalesce into one run on restart; no catchup burst is created. Renaming a function
creates a new schedule; changing its interval takes effect after its next run.
Removed functions are no longer executed even if their rows remain in the file.

Process death releases the lock and rolls back the deadline, making that run due
again. Bodies must be idempotent: external side effects can commit before a
worker dies, so execution is at least once. Retries within a live run use the
existing bounded policy; a crash restarts that policy. The transaction holds the
jobs database writer lock for the body/backoff duration. Long jobs therefore delay
other jobs in this database. Jobs must not access the scheduler database themselves.
Use an ordinary local/shared-host SQLite filesystem, not a network filesystem or
independent copies on separate hosts.

The scheduler remains lifecycle-tracked, stops scheduling during shutdown and
releases the connection/transaction on exit. `npm run test:e2e` (jobs step) runs the actual
generated native harness against two processes, kills the owning worker mid-run,
and verifies lock recovery, committed state and restart catchup (cherry-pick: `node scripts/test-jobs.mjs`).

Default `jobsPlugin` (Plus-owned, not a core builtin) remains process-local best effort (two containers run two
schedulers). Duration qualifiers are supported; cron expressions are not parsed.

## Helpers

Pure-TS, importable without codegen (pinned by the Plus jobs unit tests):

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
`swelte migrate` (Plus `db` plugin command) scaffolds
`src/lib/backend/db.v` + `db/migrations/001_swelte_kv.sql` on first run,
then applies `db/migrations/*.sql` in filename order (tracked in
`_swelte_migrations`, idempotent re-runs). Migrations are raw SQL;
app tables are yours. Framework ISR and the browser outbox have their own persistence contracts; see
[configuration](../configuration/reference.md) and [outbox](../offline-outbox/reference.md).

Rules:

- **Location:** `src/lib/backend/db.v` (or `*_backend.v`) — backend-only,
  importable from `#routes/*.v` at codegen time, never from the browser.
- **DDL/DML use `exec_none`** (`!= 101` is failure): V's `db.sqlite`
  `exec()` only steps row queries — INSERT/CREATE silently no-op through
  it. SELECTs use `exec()` + `Row.get_string/get_int`.
- **Helpers:** `plusDbPath(root, env?)`, `plusPendingMigrations(root,
  applied)` — pure-TS, pinned by the Plus db unit tests.

## `rooms` — cross-request SSE broadcast (Plus `rooms` plugin)

Any verb/`@[rpc]` publishes; a room-mode `@[sse]` fn subscribes:

```v
module chat_page
import backend
import time

pub struct SayIn {
pub:
	room string
	msg  string
}

@[rpc]
pub fn say(args SayIn) int {
	return backend.emit(args.room, args.msg) // delivered count
}

@[sse]
pub fn stream(req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) {
	room := req.query['room'] or { 'lobby' }
	ch := sub(room)
	for {
		select {
			m := <-ch {
				if !emit(m) {
					return
				}
			}
			30 * time.second {
				if !emit('__ping__') {
					return
				}
			}
		}
	}
}
```

The `(sub, emit)` trailing tail marks room mode: the harness injects a
room-subscribe closure and a frame emitter; the fn drives the stream
from live hub messages. When the fn returns (disconnect → writer breaks
→ produce ends), the harness unsubscribes everything it registered —
no leak, no send-on-closed panic. Backpressure-safe: cap-1
per-subscriber buffer, non-blocking send (a slow subscriber drops,
the publisher never stalls). Single-instance best-effort (same tier as
cron: two containers = two hubs; the `kv_*` table is the persistence
primitive when cross-restart delivery lands).

Rules:

- **Room fns need the hub:** register the Plus `rooms` plugin
  (`plugins: [roomsPlugin]`, `@swelte/plus/rooms`) — the hub transport
  (`hub.v` + `ws.v`) stages into `.swelte/backend/` when registered.
  Without it, room-mode `@[sse]` is a build error naming the fix.
- **Keep the tail exact:** `(sub fn (string) chan string, emit fn (string)
  bool)` — stripped from the client stub (harness-injected, like emit).
  A bare closure param anywhere else is a build error.
- **Return to leave:** the stream ends when the fn returns; the harness
  reaps the subscription. Heartbeat (`__ping__`) keeps idle streams
  alive through proxies (client ignores it).
- **`.swelte/` wiring:** the Plus `db` plugin stages `backend/db.v`
  (ungated — KV whenever registered); the Plus `rooms` plugin stages
  `backend/{hub,ws}.v` (ungated — hub whenever registered, pruned on
  plugin removal), so generated routes resolve `import backend` with no
  manual wiring; third-party plugin `includes` work the same way. Stale
  module dirs are pruned; `routes`/`main` names are reserved. The copy
  (and `.swelte/plugin_modules.json` marker) is pinned by core's
  `codegen-shape` + Plus `rooms` tests.

## `sockets` — first-class `@[ws]` rooms (Plus `rooms` plugin)

One socket fn per file; the fn drives both directions over the hub:

```v
module ws_rooms
import backend
import time

pub struct WsSayIn {
pub:
	room string
	msg  string
}

@[rpc]
pub fn ws_say(args WsSayIn) int {
	return backend.emit(args.room, args.msg) // delivered count
}

@[ws]
pub fn ws_rooms(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
	room := req.query['room'] or { 'lobby' }
	ch := sub(room)
	for {
		select {
			m := <-ch {
				if !emit(m) {
					return
				}
			}
			n := <-recv {
				_ = n // echo variant sends it back; rooms variant drains
			}
			30 * time.second {
				if !emit('__ping__') {
					return
				}
			}
		}
	}
}
```

The `(sub, recv, emit)` trailing tail marks socket mode: the harness
injects the room-subscribe closure, the inbound frame channel, and
the frame emitter. Hub messages stream out via `emit`; client frames
stream back via `recv` (echo: `msg := <-recv or { return }` +
`emit(msg)`; rooms: `select` on the hub channel and `recv`). When
the fn returns (or `emit`/`recv` reports death), the harness
unsubscribes everything it registered — no leak, no
send-on-closed panic. Single-instance best-effort (same tier as
cron/SSE rooms).

Transport + framing (RFC 6455, `ws.v`):

- **Upgrade:** `GET` + `Upgrade: websocket` on an `@[ws]` path is
  intercepted in `before_request` — it takes over the conn, answers
  `101` (`Sec-WebSocket-Accept` via `ws_accept_key`), and pumps frames
  both ways. Non-upgrade GETs on the same path fall through to
dispatch (404/405 as usual).
- **Frames:** server frames are unmasked text; client frames MUST be
  masked (browsers always mask — unmasked closes `1002`).
  Text surfaces via `recv`; ping → auto-pong, close → clean
  shutdown, continuation → assembled, binary/reserved →
  protocol-error close. Payloads cap at 64KB (`ws_write_text`); larger
  are a route error.
- **Client:** the TS stub is a URL builder (`__swelteWsUrl`, same
  route + query interpolation as fetch stubs). The browser opens a
  native `WebSocket` itself. E2E uses the zero-dep `wsConnect()`
  helper (`tests/e2e/helpers.js`: masked send, `nextMessage()`,
  `__ping__` skip, pong answers).

Rules:

- **Socket fns need the hub:** register the Plus `rooms` plugin
  (`plugins: [roomsPlugin]`, `@swelte/plus/rooms`) — `@[ws]` builds with
  the staged hub. Without it, `@[ws]` is a build error naming the fix.
- **Keep the tail exact:** `(sub fn (string) chan string, recv chan
  string, emit fn (string) bool)` — harness-injected, stripped
  from the client stub like SSE `emit`. A bare closure param anywhere
  else is a build error.
- **Return to leave:** the socket ends when the fn returns; `emit`
  returning `false` (dead pump) and `recv` closing (client gone) both
  mean leave. Heartbeat (`__ping__`) keeps idle sockets alive through
  proxies (client ignores it) — rooms should send it; echo need
  not (any client frame resets the read timeout).
- **Shape errors:** non-void return, any qualifier, or anything but
  `(SwelteRequest, sub, recv, emit)` is a file+line build error via the
  rooms plugin validate. Two `@[ws]` fns in one file is a build error
  (one socket per file — rooms join inside via `sub(room)`).

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
