---
name: swelte-overview
description: Swelte project orientation — routes vs lib layout, CLI commands, generated .swelte output. Use when scaffolding, explaining, or navigating a Swelte project.
---

# Swelte Overview

Swelte is V + Svelte 5. V is the compute engine (native server binary, WASM client modules). Svelte 5 is the UI. One RPC protocol bridges them. Framework extensions (jobs, embedded DB, tools) register explicitly via `swelte({ plugins: [...] })` — no builtins, no auto-discovery.

## Layout

```text
src/routes/**/*.v   — server RPC (file path is the route, `#routes/...` import → fetch)
src/lib/**/*.v      — isomorphic lib (no route, `#lib/...` import → local WASM call)
node_modules V libs — TS: `@scope/pkg/v/x.v`; V: `npm_scope_pkg.x`
.swelte/            — generated: types/routes|lib|npm/** + staged npm V + stubs
dist/server         — single self-contained prod binary + dist/ static
```

One Swelte project shape, two build targets (`docs/libraries.md`):
`swelte build` builds the application into `dist/`; `swelte package` builds
`src/lib` into separate `package/` output (JS/Svelte + declarations), with raw
V sources declared through `swelte.v.exports`. Routes are application/demo
code and never published. Packaging needs no routes or V compiler.
`npm create @swelte` asks sample + SSR, never app-vs-lib; every starter has
`build` + `package` scripts and starts private. `--template lib` selects the
reusable-V sample content, not a project type.
`swelte package` validates publication metadata and fails on `lib-*` diagnostics;
`swelte check --lib` reports them without writing. Pure Svelte/TS packages need
no V exports. Explicit `exports` define the public API; `files` includes
`package` and V sources, excludes routes and application `dist`.

`src/routes/+page.v` → `/`, `src/routes/api/greet.v` → `/api/greet`,
`src/routes/users/[id].v` → `/users/[id]`, `src/routes/files/[...rest].v` → `/files/[...rest]`.
`src/lib/**/backend/*.v` (or `*_backend.v`) is backend-only — a build error from browser code.
Npm packages opt in with `package.json` `swelte.v.exports`; Swelte stages their
modules in the reserved `.swelte/npm_*` namespace. See `docs/npm-v-libraries.md`.

## Native integrations

V already supplies PostgreSQL ORM and `db.pg`; the bundled toolchain also has
pooling, parameterized queries, pinned connections and transactions. Start with
native imports in backend modules, not a new ORM or a mandatory framework DB
plugin. Swelte's shipped SQLite plugin is not the limit of V database support.
Validate the selected V toolchain, libpq build/runtime dependencies, wire types
and existing migration history. Session advisory locks require a pinned
connection until explicit unlock and release. Database policy stays app-owned.
App-local `src/lib/backend/**/*.v` modules are staged into native compilation;
routes and `src/app.v` hooks can use ordinary V imports (`import backend`).
The PostgreSQL recipe and disposable integration test live in
`fixtures/postgres` (`npm run test:dogfood:postgres`).

Native process lifecycle also reuses V's `veb.Server.shutdown`. Swelte wires
signals, admitted-work drain and bounded `@[shutdown]` cleanup; plugin jobs
start after successful `@[startup]`. App-owned workers must stop/join before
shared resources close. `@[report]` adapts native errors/request IDs to the
app's logger; it does not export original JS stacks. See `docs/lifecycle.md`.

`swelte.images` builds local PNG/JPEG resize/WebP variants with a host V tool
and libwebp development files; `#app/images` exposes metadata to client/SSR.
Public native ISR caches anonymous queryless pages and atomically replaces stale
HTML in the background. `serviceWorker.outbox` opts endpoints into explicit
IndexedDB/Background Sync delivery via `enqueueOffline`; endpoints deduplicate
`Idempotency-Key`. Plus `createJobsPlugin({ durable: true })` persists schedules
and coordinates processes sharing `SWELTE_JOBS_PATH` (separate SQLite file).
The Plus `db` plugin (`swelte({ plugins: [dbPlugin] })`) provides embedded
SQLite/KV + `swelte migrate` (see `plus.md`); register the jobs plugin
(`jobsPlugin` / `createJobsPlugin({ durable: true })`) for `@[cron]` ticks.
The room/WS hub (`hub.v` + `ws.v`, `@[ws]` + room-mode `@[sse]` dispatch)
arrives only with the Plus `rooms` plugin (`swelte({ plugins: [roomsPlugin] })`).
See `docs/images.md`, `docs/outbox.md`, `docs/config.md`, `docs/cli.md` (`swelte migrate`), `docs/plus.md`, and `docs/rpc.md` (cron/jobs + rooms/sockets).

## Commands

```sh
npm create @swelte myapp && cd myapp
npm install
npx swelte dev      # Vite :5174 + V backend :8131, one command
npx swelte build    # typecheck + dist/server + vite build + smoke probe
npx swelte package  # library build + publication validation (src/lib -> package/)
npx swelte preview  # serve the build, no Vite involved
npx swelte test     # v test + TS contract check (+ swelte.contract.json snapshot)
npx swelte check    # diagnostics without side effects (text|json)
```

`swelte dev` resolves V itself (system `v`, else `@swelte/vvm` toolchain).
`vite.config.ts` wires `swelte({ vBackendUrl })` (all other knobs live in the `svelte.config.js` `swelte` key: `routesDir`, `libDir`, `outDir`, `distDir`, `port`, `corsOrigin`, `trailingSlash`, `base`, `assets`, `csp`, `csrf`, `methodOverride`, `version`, `serviceWorker`, `prerender`, `isr`, `target`, `offline`, `images`).

## SPA-first proxy rule

`GET /` (no `Accept: application/json`) always serves the Vite page.
Only proxied to V: `Accept: application/json` GETs, JSON bodies, form bodies.
Browser refresh never hits the API; `curl` does.

## Sources

Stable only — no spec dependency:

- `docs/README.md` — doc index (root = built behavior, `internal/` = rationale, `specs/` = contracts, capability probes, and future work)
- `docs/example.md` — canonical `examples/something` demo
- `docs/versus.md` — positioning vs SvelteKit, Rust, Go, LiveView
- `README.md` — quickstart

Do not update this skill when `docs/specs/*` changes.
