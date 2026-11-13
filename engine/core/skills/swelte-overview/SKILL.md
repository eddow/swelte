---
name: swelte-overview
description: Swelte project orientation — routes vs lib layout, CLI commands, generated .swelte output. Use when scaffolding, explaining, or navigating a Swelte project.
---

# Swelte Overview

Swelte is V + Svelte 5. V is the compute engine (native server binary, WASM client modules). Svelte 5 is the UI. One RPC protocol bridges them.

## Layout

```text
src/routes/**/*.v   — server RPC (file path is the route, `#routes/...` import → fetch)
src/lib/**/*.v      — isomorphic lib (no route, `#lib/...` import → local WASM call)
node_modules V libs — TS: `@scope/pkg/v/x.v`; V: `npm_scope_pkg.x`
.swelte/            — generated: types/routes|lib|npm/** + staged npm V + stubs
dist/server         — single self-contained prod binary + dist/ static
```

Libraries keep the same split one level up (`docs/libraries.md`): `src/lib`
is the published surface (built `dist/` for JS/Svelte via `svelte-package`,
raw `src/lib/**/*.v` for V via `swelte.v.exports`), `src/routes` is the
local dogfood/test/demo (never published, never routed in consumers).
`swelte init` asks app-vs-lib (`--lib` / `--kind lib` / `--template lib`
skip the prompt); libraries get `"build"` (dogfood, same as apps) plus
`"build:lib": "svelte-package && swelte check --lib"`. `swelte check --lib`
validates the schema as `lib-*` warnings.

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
`fixtures/postgres` (`npm run test:postgres`).

## Commands

```sh
npx @swelte/core init myapp && cd myapp
npm install
npx swelte dev      # Vite :5174 + V backend :8131, one command
npx swelte build    # typecheck + dist/server + vite build + smoke probe
npx swelte preview  # serve the build, no Vite involved
npx swelte test     # v test + TS contract check (+ swelte.contract.json snapshot)
npx swelte check    # diagnostics without side effects (text|json)
```

`swelte dev` resolves V itself (system `v`, else `@swelte/vvm` toolchain).
`vite.config.ts` wires `swelte({ vBackendUrl })` (all other knobs live in the `svelte.config.js` `swelte` key: `routesDir`, `libDir`, `outDir`, `distDir`, `port`, `corsOrigin`, `trailingSlash`, `base`, `assets`, `csp`, `csrf`, `methodOverride`, `version`, `serviceWorker`, `prerender`, `isr`, `target`, `offline`).

## SPA-first proxy rule

`GET /` (no `?q=`, no `Accept: application/json`) always serves the Vite page.
Only proxied to V: `Accept: application/json` GETs, JSON bodies, form bodies.
Browser refresh never hits the API; `curl` does.

## Sources

Stable only — no spec dependency:

- `docs/README.md` — doc index (root = built behavior, `internal/` = rationale, `specs/` = remaining polish notes)
- `docs/example.md` — canonical `examples/something` demo
- `docs/versus.md` — positioning vs SvelteKit, Rust, Go, LiveView
- `README.md` — quickstart

Do not update this skill when `docs/specs/*` changes.
