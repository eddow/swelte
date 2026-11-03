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
.swelte/            — generated: types/routes|lib/** + generated/ stubs + v-shim.d.ts
dist/server         — single self-contained prod binary + dist/ static
```

`src/routes/+page.v` → `/`, `src/routes/api/greet.v` → `/api/greet`,
`src/routes/users/[id].v` → `/users/[id]`, `src/routes/files/[...rest].v` → `/files/[...rest]`.
`src/lib/**/backend/*.v` (or `*_backend.v`) is backend-only — a build error from browser code.

## Commands

```sh
npx swelte init myapp && cd myapp
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
