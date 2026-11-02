# Moar — server lifecycle (cron, queue) + cross-build

This file tracks TODO only. Built server-lifecycle behavior
(`@[startup]`, `@[reroute]`) lives in `docs/config.md` +
`docs/coming-from-sveltekit.md`.

## Use of swelte.contract.json

Review how useful to commit a generated file

## `src/server.v` — remaining

```v
module server

// duration only ('60s' | '5m' | '1h') — no cron-expr parser in v1.
// spawn + time.sleep loop, single-instance best-effort.
// Timeout watchdog does NOT apply — long-lived by design, like SSE.
@[cron('60s')]
pub fn tick() { ... }

// message queue consumer. v1: in-process channel fed by route handlers
// (no external broker). Signature TBD — must stay WASM-free anyway.
@[queue('mail')]
pub fn on_mail(msg string) ! { ... }
```

TODO:

* `@[cron]`: duration literal validation, spawn loop in harness
  (body must be idempotent; no watchdog).
* `@[queue]`: name literal, v1 in-process channel plumbing.
* Both: zero/one-or-more? qualifier rules, no TS callable, `pub struct`s
  NOT projected (Hand-level, like `@[startup]`/`@[reroute]`).
* Misplaced `@[cron]`/`@[queue]` in `src/routes/*` = build error.

## Cross-build (`swelte build --target-os`)

TODO: `swelte build [--target-os <os>]` (`linux`|`macos`|`windows`)
+ `targetOs?` in the `swelte` config key (CLI flag wins, env
`SWELTE_TARGET_OS` middle, config fallback):

* `build.ts` passes `-os <os>` to the `v -o` link. Smoke probe skips
  when target != host (foreign binary can't boot) — assert artifacts only.
* QJS embed is the hard part: `libqjs.a` is prebuilt for the HOST.
  Needs per-OS prebuilt (`libqjs-<os>.a`) or from-source QJS compile
  under the target cc. Core-only projects cross trivially today.
* WASM untouched: always `-os browser`.
* `dev`/`preview`/`test` stay host-native — flag is `build`-only.

## Open decisions

* File name: `src/server.v` clashes conceptually with generated
  `.swelte/server.v` + template `templates/harness/server.v`.
  Candidates: `src/hooks.v`, `src/app.v`, `src/lifecycle.v`.
* `@[queue]` transport: in-process chan vs external broker — v1 is
  in-process; broker (if ever) is a later item, not this file's problem.
