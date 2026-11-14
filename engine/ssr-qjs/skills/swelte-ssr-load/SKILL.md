---
name: swelte-ssr-load
description: Swelte SSR and page-data loading — @[load] cascade, +route wrappers, Hand request path, +error contract, SSR budgets. Use when adding page-load data, debugging SSR output, or working on server rendering.
---

# Swelte SSR + Load

## Ownership (locked)

- `core` is engine-agnostic: manifest (`.swelte/ssr-manifest.json`), `Hand` SSR hook, marker injection, client entry, `loadPage` twin. Core never imports `svelte/compiler`, QuickJS, or a JS runtime; `build`/`dev`/`preview` never start an engine. `SWELTE_SSR_URL` is the only bridge — `Hand` proxies when set, skips when not. Default is SPA/static + JSON, always.
- `@swelte/ssr-qjs` (default engine) owns the SSR compiler, vendored QuickJS prod embed, dev sidecar, `runSsrDev`/`runSsrCheck`.

## Request path

Browser `GET /` (`Accept: text/html`) → `Hand.before_request` → `swelte_ssr_enabled()` → `swelte_page_props()` (`swelte_load_for()` cascade) → embedded QuickJS `renderRoute(path, props)` (or sidecar POST when `SWELTE_SSR_URL` is set) → HTML at `<!--ssr-body-->` + `data-swelte-ssr="1"` on `#app`. Failures → SPA shell / `+error` HTML — never blank/JSON for navigations. `Accept: application/json` bypasses SSR (API stays JSON). A load envelope with 3xx status and `Location` can redirect an HTML GET; middleware redirect support is a separate contract.

## `@[load]` cascade

The guarded versioned envelope is shared by HTML, client navigation and refresh,
including Svelte-only leaves inheriting wrapper loads. SSR renders wrappers and
page in one tree, preserving head and context; initial JSON is escaped into
`__swelte_page` for hydration. `compat: 'sveltekit'` selects nested data/form
props and reactive `$app/state`; default flat props remain supported.
`invalidateAll()` awaits refresh and updates mounted props without remounting.
Universal loads receive `depends(...tags)`; navigation `invalidate(tag)` awaits
refresh for matching active loads. Native `invalidate()` keeps its synchronous
matching-key return; use `invalidateAsync()` to await. Action exceptions render
the nearest route error component, while validation failures remain on `page.form`.
Pending navigation takes priority over refresh; stale/aborted action results
cannot publish after an awaited refresh. These are response/commit guards,
not rollback of server-side work.

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

Directory `+error.svelte` files inherit through physical ancestry (including
groups), with `{ status?: number; message?: string }`. SSR and client use the
same selection. Boundaries retain wrappers strictly above their directory,
using successful parent load data, and replace the local wrapper/page. A broken
boundary or retained wrapper falls back to the next ancestor. SSR records the
chosen boundary for hydration. Unknown URLs select matching ungrouped scopes,
then root. JSON/API errors retain their envelope. See `docs/ssr.md`.

## Prerender

`prerender.entries: 'all'` expands sibling `entries.ts/js` beside dynamic
leaves, including physical route groups. Flags inherit through group wrappers;
leaf flags override them. The native crawler skips redirects/errors/SPA shells,
keeps `/` dynamic and only prunes artifacts recorded in its ownership manifest.
Assert translated body/head and hydrate actual static files; HTTP 200 alone
can be an unrendered shell. Canonicals need the application's public origin,
while `$app/state.url` rebases to the browser hosting URL. See `docs/config.md`.

## Installed UI dependencies

The SSR bundler resolves installed ESM/Svelte package exports and compiles
transitive `.svelte`, `.ts` and `.svelte.ts/js` modules for synchronous SSR.
Unresolved imports fail composition instead of remaining external in a broken
QuickJS bundle. Browser-only/Node server dependencies still need separation;
package installation does not make an asynchronous or Node backend QJS-safe.

## Budgets (measured 2026-10-31, `examples/something`, 73KB bundle)

- `renderRoute('/')` in-process: ~0.012ms/render.
- End-to-end browser `GET /` vs `dist/server` (`SWELTE_SSR=1`): ~3–12ms wall; 404 `+error` ~3ms; JSON API ~0.4ms.
- Binary delta (vendored QuickJS + glue): +~1MB.
- Design envelope: ~50ms timeout → SPA fallback, ~16MB cap.
- `SWELTE_SSR_STRICT=1` makes unexpected native fallback a 500. Diagnostics
  report route/reason (`timeout`, `memory-limit`, `output-limit`, etc.) without
  props or raw exception bodies. `SWELTE_SSR_DIAGNOSTICS=1` opts original
  QuickJS exception details into native diagnostics for investigation; clients
  and the `@[report]` hook never receive JS stacks. Head/body buffers grow to
  64 KiB/1 MiB; overflow fails explicitly. Strict browser hydration also
  rejects fallback.

## Sources

Stable — all built including per-route `ssr=false`-lite:

- `docs/ssr.md` — ownership, request path, cascade, contract, budgets, gate (source of truth)
- `docs/internal/load.md` — cascade design rationale (ephemeral; contract lives in `rpc.md`)
- `docs/rpc.md` — `@[load]` attribute rule
- `docs/config.md` — per-route `ssr=false`-lite (`export const ssr = false` → manifest flag → `Hand` skips rendering, serves SPA shell; async universal `load` stays client-only)
- `docs/coming-from-sveltekit.md` — `ssr=false`-lite rendering row

- `docs/ssr.md` — ownership, request path, cascade, contract, budgets, and verified SSR behavior
