# Spec: SSR engines 

* `core` stays pure, backend-focused, and 100% engine-agnostic. It already lists `*.svelte` files (folder-root double-claim check counts `foo.svelte` vs `foo/+page.*` on either extension). No React/Vue reuse — do not complicate for a hypothetical UI-agnostic future, but crucially, **`core` knows nothing about qjs or bun**.
* Instead, SSR adapter packages (like `@swelte/ssr-qjs` and `@swelte/ssr-bun`) **extend and re-export `@swelte/core**`, injecting their respective build and runtime capabilities without polluting the core package.
* Two SSR engines, both outside the request hot path of `@swelte/core`:
1. `qjs` first (default via `@swelte/ssr-qjs`): embedded QuickJS in the V binary.
Dev = plain JS + HMR. Prod = `qjsc` bytecode.
2. `bun` second (opt-in via `@swelte/ssr-bun`): full `svelte/server` `render()`, async/streaming, npm compat. Never the default.



---

## 1. Contract & Architecture (Extended via Adapters)

`core` owns only what it already owns, extended by one scan:

* Route manifest: `src/routes/**/*.svelte` (+ `+page.svelte`,
`+route.svelte` wrappers per §7, single global `+error.svelte`,
dynamic `[id]` / `[...rest]` passthrough) → URL pattern.
Reuses the `routeFor` / `doubleClaimCheck` scan in `vite.ts`;
no new resolver, just also collect `.svelte` siblings.
* Data in / HTML out: props are JSON built by V
(`SwelteRequest(params,query,form,headers,cookies) → @[get]/@[rpc]/@[before]`
chain, same as today). Rendering is `render(route, props_json) → html`.
`load()` stays in V; JS stays pure-sync
(`(props, params) -> { head, body }`, no `fetch`, no top-level `await`,
no event-loop pumping — the QuickJS-compatibility rule).
* Dispatcher rules stay in `core`/V, never in adapters:
trailing-slash stripped before `swelte_match_route`
(`/api/greet/ == /api/greet`, no redirect, `<link rel=canonical>`);
`swelte_route() == 404 containing 'not found'` + `GET` + `SWELTE_DIST set`
→ SSR-or-static-or-SPA chain (§2c);
`!T` failure or unknown path → global `+error` render (HTML 404/500),
never blank/JSON for page navigations.

### Pre-SSR `+error` contract (no engine needed)

Page shells are public; page data is guarded. Until an engine lands,
Vite serves shells unguarded in dev and the client renders `+error`:

* `src/routes/+error.svelte` — single global, props
  `{ status?: number; message?: string }`. Same file SSR renders
  server-side later; no throwaway work. 4xx shows a login/home link.
* `loadPage(fn)` in `@swelte/core` (`sdk.ts`): runs a `.v` stub, maps
  `SwelteRpcError` (or any throw → 500) to
  `{ error: { status, message } }` for the `+error` view.
  **Page-data loads only** (`get_greeting`, `admin_whoami` at load
  time). Action-time failures (button POSTs: `save_name`, form
  submits) stay inline field errors — never full-page `+error`.
* Each `+page.svelte` conditionally renders `<ErrorPage .../>` when its
  `loadPage()` result is the error branch (manual today; the future
  client router does it centrally with the same component + props).

Dev/prod parity: `GET :vite/admin` (no cookie) → `load()` 400
`missing session` → client `+error(400)`; post-SSR `GET :prod/admin` →
`Hand` runs `swelte_route()` first → same `+error(400)` HTML. Same
component, same status, two paths. No-JS: shell loads, data never
arrives — honest gap, closed by SSR (feeds §12).

### Plugin Shape (Adapter-Driven Extension)

Instead of `core` managing engine flags internally, the adapter packages wrap or extend `@swelte/core`:

```ts
// User imports from the engine adapter, which re-exports and augments core
import { swelte } from '@swelte/ssr-qjs'; // or '@swelte/ssr-bun'

swelte({
  vBackendUrl, routesDir, libDir,
  // engine-specific options handled entirely by the adapter
})

```

`core` remains completely clean; adapters handle their own dynamic imports and build augmentations.

---

## 2. Engine 1: `@swelte/ssr-qjs` (build first)

Goal: `dist/server` stays one file, `dist/` + binary boots bare-metal.

### 2a. Build outputs

* `vite build` (client, unchanged) + one SSR entry:
`dist/ssr/render.js` — single IIFE, no `node:` externals, no `fetch` /
top-level `await` (build error otherwise, file+line).
Entry composes the manifest: route pattern → component,
`+route.svelte` nesting (`children` snippet), global `+error.svelte`
fallback. Compiled with the project's own `svelte()` plugin in SSR mode
(`generate: 'server'`), so `core` never imports `svelte/compiler`.
* Dev: ship `render.js` as-is. Vite serves/HMRs it; V reads it from disk
per request (mtime-guarded cache) so Svelte edits hot-reload with no
V restart — same mtime-guard pattern as §6 `.swelte/dev/*.wasm`.
* Prod: `qjsc -o render.c render.js` (bytecode-as-C) then linked into the
V binary via V C-interop (`#include "quickjs.c"`, vendored amalgamation
under `engine/ssr-qjs/c/`). Fallback if `qjsc` C output proves awkward:
`qjsc -b -o render.qbc` + `embed_file`. Either way exactly one
`dist/ssr/render.*` artifact; V embeds it (`embed_file` or `SWELTE_DIST`
read — same choice as WASM `app_lib`, keep consistent).

### 2b. V runtime bridge

New `swelte_render(route, props_json) -> html` in the adapter's V shim
(copied verbatim into `routes/` by `generate()`, same pattern as item 23
static-vlib decision — never `-I node_modules`):

* Per request: new QuickJS runtime+context (or small pool),
`eval(render.js once) + eval(renderRoute(props))`.
* Guards: timeout (~50ms budget, then fall back to SPA shell),
memory cap (~16MB), no `fs/net/process` shims exposed.
Renderer cannot leak secrets — mirrors the `#lib/backend` guard.
* Failure anywhere (throw, timeout, missing route) → `render(+error, {status})` HTML with the right status code.

### 2c. `server.v` / `Hand` chain (both engines share this)

GET page navigation:
`swelte_route()` hit (200, JSON props)
→ engine render(props) → 200 text/html (or +error 500 on throw)
`swelte_route()` 404 'not found' + `dist/` present
→ SSR 404: render(+error, {status:404}) → 404 text/html
→ (no +error.svelte? → today's SPA fallback: serve index.html 200)
`/` always static in prod (existing rule: `@[get]` on `/` dev only).

`Accept: application/json` bypasses SSR (API stays JSON — today's probes
unchanged). HTML navigations get HTML; `fetch` gets JSON.

### 2d. Hydration (template change)

`init` template + example `main.ts` switch from `mount()` to
`hydrate()` when SSR HTML is present (fallback to `mount` on SPA shell).
`app.html` gains SSR placeholders (`<!--ssr-head-->`, `<!--ssr-body-->`)
that `Hand` fills; client bundle hydrates against them. No-JS still shows
rendered HTML (feeds item 12 proof later).

---

## 3. Engine 2: `@swelte/ssr-bun` (opt-in sidecar, after qjs)

* Separate package, own deps (`svelte`, `bun`). `core` remains entirely independent of it.
* Protocol identical: `POST localhost:$BUN_SSR {route, props} → {html, head}`.
V `Hand` proxies when `SWELTE_SSR_URL` is set, else skips.
* Gets what qjs can't: async `load()`, streaming/Suspense, full npm compat.
Pays the sidecar: `server + bun + node_modules` in prod — explicitly opts
out of §19 single-artifact.
* DX role even for qjs users: `bun` pre-renders/snapshot-tests the same
`render.js` in CI (`bun --hot` in dev), so qjs prod output is verified
with full-fidelity tooling without shipping it.

---

## 4. Work order

1. Manifest + `+error.svelte` discovery + trailing-slash strip in dispatcher (built in `core`).
2. `@swelte/ssr-qjs` package creation: extending `core`, `render.js` file dev path, disk-read bridge, HMR guard, `hydrate()` template, `Hand` HTML/JSON content-negotiation.
3. `@swelte/ssr-qjs` prod path: `qjsc` bytecode + embed + timeout/mem caps + `+error` fallback. Size budget: binary delta <3MB.
4. `@swelte/ssr-bun` package: sidecar HTTP, `preview --ssr=bun`, streaming test.
5. §9 tests green (below), then close §9; default remains SPA fallback until an adapter is explicitly opted into.

---

## 5. Tests (§9 close-out)

* `GET /nope` → 404 `text/html` `+error` render (not blank/JSON);
missing `+error.svelte` → SPA `index.html` 200 (back-compat).
* `GET /api/greet/` → same handler as `/api/greet` (strip, no redirect);
`Accept: application/json` on a page route → JSON, not HTML.
* `throw` in a handler (`!T`) → `+error` 500 HTML, server stays up.
* qjs: `dist/server` + `dist/` on bare machine (no node/vite/source/bun) →
page HTML + API JSON on one port; `ls dist/ssr/` shows one artifact.
* qjs dev: touch `+page.svelte` → HMR swap, no V restart, no stale HTML.
* bun (opt-in): streaming route delivers progressive chunks; kill mid-stream
→ client disconnect path per policy.

---

## 6. Non-goals

* No per-directory `+error` inheritance (locked: single global).
* No React/Vue adapters in core — `core` lists `.svelte` because Swelte is Svelte.
* No async in qjs renderer (use `bun` if you need it).
* **No `core` dependency on `svelte/compiler`, `quickjs`, or `bun**`. Adapters depend on them and extend/wrap `core`; `core` remains completely ignorant of rendering engines.