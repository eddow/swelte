# Explicit Swelte plugins and restoration of Plus

The application will enable framework extensions through the existing `swelte({ plugins: [...] })` configuration. Core owns discovery of application source, V parsing, route and server generation, lifecycle ordering, and staging generated files. AI owns tool declarations and dispatch. Plus will again own jobs and the embedded backend services. This roadmap supersedes the automatic dependency discovery prototype described in [the AI spec](ai.md). Each checkbox below is planned work.

## 1. Extend the existing plugin contract

- [x] Give a registered plugin access to the parsed declarations it claims, their source, structs, module path and location. Cover `src/app.v`, routes and backend/shared library files. Keep application startup in `src/app.v`. An enabled plugin can contribute startup and shutdown calls to library code through the generated server.
- [x] Add a generation hook that returns named output files. Core validates ownership, rejects collisions and prunes stale output on regeneration or plugin removal. Support contributions such as CLI commands and runtime includes even when an app declares no matching attributes.
- [x] Resolve the configured plugins consistently for dev, check, build and CLI commands. Define initialization order relative to application startup, reverse cleanup order, and failure behavior. Verify with two fixture plugins and an application startup hook.

## 2. Move AI onto explicit registration

- [x] Expose the AI tools generator as a Swelte plugin and enable it in the shell example. Replace the automatic `./swelte/build` lookup and update its documentation and tests.
- [x] Build a provider-only app without the plugin and a tool-using app with it. Verify that only the latter emits bindings and can call a selected native tool. Remove the plugin and regenerate in the same output directory to check cleanup.

## 3. Restore Plus feature by feature

- [x] Move cron parsing, schedule validation, retry and durable scheduling, V runtime and startup wiring back into `engine/plus`. Verify an app-declared tick starts once and survives the existing retry and persistence tests.
- [x] Move embedded SQLite/KV, migration helpers and the `migrate` command into Plus. The configured command resolves via the project's `plugins: [dbPlugin]` entry (before any app build), verified against pending and applied migrations on an existing database.
- [x] Move the room hub and its SSE/WebSocket integration into Plus (`roomsPlugin` claims `@[ws]` + room-mode `@[sse]`, stages `backend/{hub,ws}.v`). Core retains the HTTP verbs, plain SSE (list/emit) and WS transport (upgrade handshake, socket pump, `__swelteWsUrl`). Route-generation hooks wired for room dispatch: `emitRoute` appends per-file `sse_room` / `swelte_ws_open` accessors, `emitServerGen` appends the `sse_is_room` / `sse_room_for` / `ws_route` / `ws_is` / `ws_open_for` fan-out (core skips those tables for claimed mods — no duplicate symbols). Exercised live: room broadcast + disconnect in a Plus app, plain SSE streaming in a core-only app (both against real native builds).
- [x] At each extraction, remove the corresponding builtin registration and feature-specific branches from core (box 3: `ws` leaves `CORE_ATTRS`, core `validateWsFn`/`emitWsEvents`/`hub-gate` removed, core hub-vlib + `{hub,ws}.v` staging gates removed; dependency stays Plus → core plugin API). Consuming examples/scaffolds updated in the same change (`something` + `shell` + `tests` + dogfood fixtures register `roomsPlugin`; Plus `vlib` split per-plugin: `db/` vs `rooms/`).

## 4. Verify the package and release boundary

- [x] Build clean consumers from packed packages with core alone, core + Plus, and core + Plus + AI (`scripts/test-pack-matrix.mjs`: no `./jobs` export / no Plus install core-alone; Plus `./jobs` + `./db` + `./rooms` entry points + `migrate` command + `swelte({ plugins: [jobsPlugin, dbPlugin, roomsPlugin] })` resolution; ai entry point alongside). Core-only ships no embedded SQLite runtime (only Plus `vlib/db/db.v` imports `db.sqlite`; core stages no backend V modules). Native-link + startup through the normal app entry points remains covered by `test-install.mjs` / `test-jobs.mjs`, not the matrix.
- [x] Inventory public imports against the last published versions. Plus `./jobs` + `./db` entry points restored (§3 boxes 1–2: same specifiers as 0.1.5, now jobs + SQLite/KV plugins + `migrate` instead of the retired bundle) plus new `./rooms` (box 3: hub + `@[ws]`/room-SSE dispatch); core `./jobs` re-export removed (`engine/core/package.json` matches 0.1.5 surface + `vite/config/diagnostics/toolchain`; `backend/hub-*` stays internal via `@swelte/core/vite`). No Plus deprecation notice was ever published on npm; `docs/plus.md` + CLI/config/library guides use explicit `swelte({ plugins: [jobsPlugin, dbPlugin, roomsPlugin] })` registration. Package versions aligned at 0.2.0; `sync-version.mjs` + `publish-engine.yml` treat Plus as an active 0.2 participant (stale `retired` comment + `0.1.x -> 0.2.0` wording fixed; fixture pins `engine/plus`).
- [x] CLI, configuration and library-authoring guides use explicit `swelte({ plugins: [jobsPlugin, dbPlugin, roomsPlugin] })` registration (`docs/cli.md`, `docs/config.md`, `docs/libraries.md`, `README.md`, `engine/core/README.md`, `engine/plus/README.md`, skills, docs-site). No Plus deprecation notice exists anywhere in the repo or on npm — nothing to replace.

[Existing plugin contract](../../engine/core/src/vite/types.ts) · [Historical Plus behavior](../plus.md) · [Release policy](versioning.md)

PS:
- at the end of the day, all the docs have to be updated: docs/*.md, skills, docs-site - at best these are maintained but a final review will be needed
- all deprecated/retired "functionalities" have to be reviewed for cleanup
- `scripts/` folder must contain a load of scripts who have become useless and should be cleaned up too