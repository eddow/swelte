# Moar — server lifecycle (startup, cron, MQ, reroute)

Server-only central file. Never WASM, never fetch-stubbed — same guard as
`@lib/backend`: resolving from browser/`#lib/` WASM stubs is a build error.
Pure V (no TS sidecar).

## `src/server.v` (name TBD: `server.v` vs `hooks.v` vs `app.v`)

One file, four concerns. No `handle/handleFetch/handleError`
(SvelteKit hook surface explicitly out — `+route.v`
`@[before]/@[after]` already covers request middleware, including what
`transformPageChunk` does: `@[after](req, code, body) -> (code, body)`
rewrites the final HTML string; Swelte never chunks, so there is nothing
to transform per-chunk. See item 14 in `./sveltekit.md`).

```v
module server

// once, from Hand main(), before veb.run
@[startup]
pub fn init() { ... }

// duration only ('60s' | '5m' | '1h') — no cron-expr parser in v1.
// spawn + time.sleep loop, single-instance best-effort
// (same caveat as SwelteBucket rate-limit: multi-instance approximates).
// Timeout watchdog does NOT apply — long-lived by design, like SSE.
@[cron('60s')]
pub fn tick() { ... }

// message queue consumer. v1: in-process channel fed by route handlers
// (no external broker). Signature TBD — must stay WASM-free anyway.
@[queue('mail')]
pub fn on_mail(msg string) ! { ... }

// host/path rewrite before dispatch (SvelteKit `reroute` equivalent).
// Runs before swelte_match_route; returns rewritten path or '' for no-op.
// micro needs: bills.* -> /bills, market.* -> /market, /arb2b/* -> /market/*.
@[reroute]
pub fn rewrite(host string, path string) string { ... }
```

## Wiring

* `renderHarness` (`engine/core/src/gen/config.ts:150`) is verbatim today
  → must template: emit `routes/swelte_hooks.v`
  (`pub fn swelte_startup()`, `pub fn swelte_reroute(host, path) string`,
  cron spawns) that `server.v` calls when present. Only harness touch.
* `@[startup]`: zero/one fn, `() -> void` (or `!void`?), no args.
  Multiple = build error.
* `@[cron]`: duration literal; body must be idempotent.
* `@[queue]`: name literal; v1 in-process only (no broker dep).
* `@[reroute]`: `(string, string) -> string`; runs before static/dynamic
  match, after `trailingSlash` normalization. Must be pure + fast
  (every request).
* All four: no TS callable (like `@[before]/@[after]`), `pub struct`s
  still projected (layout-shaped shared types, same rule).

## Order

`@[startup]` + `@[reroute]` first (harness call-sites only),
`@[cron]` second (spawn loop), `@[queue]` last (channel plumbing).

## Open

* File name: `src/server.v` clashes conceptually with generated
  `.swelte/server.v` + template `templates/harness/server.v`.
  Candidates: `src/hooks.v`, `src/app.v`, `src/lifecycle.v`.
* `@[queue]` transport: in-process chan vs external broker — v1 is
  in-process; broker (if ever) is a later item, not this file's problem.
* Matcher co-location: REJECTED — `@[matcher]` fns live in their own
  `src/matchers.v` (see item 10 in `./sveltekit.md`), NOT here. Matchers
  must be client-available (sync SPA router) and WASM-safe; this file
  imports `time`/`os` (cron/startup) which poisons `v -b wasm`.
