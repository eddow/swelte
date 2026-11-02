---
name: swelte-ssr-load
description: Swelte SSR and page-data loading — @[load] cascade, +route wrappers, Hand request path, +error contract, SSR budgets. Use when adding page-load data, debugging SSR output, or working on server rendering.
---

# Swelte SSR + Load

## Ownership (locked)

- `core` is engine-agnostic: manifest (`.swelte/ssr-manifest.json`), `Hand` SSR hook, marker injection, client entry, `loadPage` twin. Core never imports `svelte/compiler`, QuickJS, or bun; `build`/`dev`/`preview` never start an engine. `SWELTE_SSR_URL` is the only bridge — `Hand` proxies when set, skips when not. Default is SPA/static + JSON, always.
- `@swelte/ssr-qjs` (default engine) owns the SSR compiler, vendored QuickJS prod embed, dev sidecar, `runSsrDev`/`runSsrCheck`.

## Request path

Browser `GET /` (`Accept: text/html`) → `Hand.before_request` → `swelte_ssr_enabled()` → `swelte_page_props()` (`swelte_load_for()` cascade) → embedded QuickJS `renderRoute(path, props)` (or sidecar POST when `SWELTE_SSR_URL` is set) → HTML at `<!--ssr-body-->` + `data-swelte-ssr="1"` on `#app`. Failures → SPA shell / `+error` HTML — never blank/JSON for navigations. `Accept: application/json` bypasses SSR (API stays JSON). `GET` navigations never redirect (`303` is POST-only).

## `@[load]` cascade

Initial paint data comes from a `load` fn; interaction data comes from stubs.

```v
// admin/+route.v — level 0: exactly one param (SwelteRequest)
@[load]
pub fn load_layout(req SwelteRequest) !AdminLayout {
    return AdminLayout{ section: 'admin' org_id: 7 }
}

// admin/+page.v — deeper levels: (SwelteRequest, parent T)
@[load]
pub fn load_admin(req SwelteRequest, parent AdminRoute_AdminLayout) !AdminProps {
    return AdminProps{
        user: req.headers['x-user'] or { 'unknown' }
        section: parent.section
        org_id: parent.org_id
    }
}
```

- Zero or one per `.v` file; never stacked with a verb/rpc/sse; no qualifier.
- Parent type is the previous level's return struct (short or prefixed spelling — mismatch = build error). `Hand` threads typed values root-first; the leaf's return is `json.encode`d once at the edge → `props_json`.
- Throw → `+error` props with status. No loads on the chain → `'{}'` (static shell, hydrates, client fetches).
- `+route.v` may hold `@[load]` alongside `@[before]/@[after]` (still no `@[rpc]`/verbs). `@[before]` mutates `req` before loads see it.
- No JSON in `.v` files: no `import json`, no `json.encode`/`decode`.

## `+error` contract

Single global `src/routes/+error.svelte`, `{ status?: number; message?: string }`. 404 unknown path, 4xx guard rejects, 500 handler throws — all HTML with the right status, server stays up. Missing `+error.svelte` → SPA `index.html` 200.

## Budgets (measured 2026-10-31, `examples/something`, 73KB bundle)

- `renderRoute('/')` in-process: ~0.012ms/render.
- End-to-end browser `GET /` vs `dist/server` (`SWELTE_SSR=1`): ~3–12ms wall; 404 `+error` ~3ms; JSON API ~0.4ms.
- Binary delta (vendored QuickJS + glue): +~1MB.
- Design envelope: ~50ms timeout → SPA fallback, ~16MB cap.

## Sources

Stable — all built including per-route `ssr=false`-lite:

- `docs/ssr.md` — ownership, request path, cascade, contract, budgets, gate (source of truth)
- `docs/internal/load.md` — cascade design rationale (ephemeral; contract lives in `rpc.md`)
- `docs/rpc.md` — `@[load]` attribute rule
- `docs/config.md` — per-route `ssr=false`-lite (`export const ssr = false` → manifest flag → `Hand` skips rendering, serves SPA shell; async universal `load` stays client-only)
- `docs/coming-from-sveltekit.md` — `ssr=false`-lite rendering row

- `docs/specs/ssr.md` — open work only (`ssr-bun`, dev auto-sidecar UX, gate-as-CI); not required to use this skill
