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
* 
# Handoff: SSR engines — status as built

Ephemeral. Durable contracts live in `docs/rpc.md` (Attributes, SSR
component rule), `engine/*/README.md`, and code comments. This file
records where the work stands and what remains.

## Ownership (locked)

* `core` is engine-agnostic and stays that way. It provides: the
  `.svelte` route manifest (`.swelte/ssr-manifest.json`), the `Hand`
  SSR hook (`swelte_ssr_enabled()` / `swelte_render_page()` /
  `swelte_page_props()` / `swelte_fill_ssr()` in `server.v`), marker
  injection in `transformIndexHtml`, the generated client entry
  (`.swelte/entry-main.ts`), and the `loadPage` client twin in `sdk.ts`.
  Core never imports `svelte/compiler`, QuickJS, or bun; core's
  `build`/`dev`/`preview` never start an engine. `SWELTE_SSR_URL` in the
  environment is the only bridge — `Hand` proxies when set, skips when
  not. Default is SPA/static + JSON, always.
* `@swelte/ssr-qjs` (default engine) owns: the SSR compiler, the
  dev sidecar (Node HTTP, dev-only), its own lifecycle commands
  (`runSsrDev`, `runSsrCheck`), and — open — the QJS embed.
* `@swelte/ssr-bun` (opt-in) does not exist yet. Same HTTP protocol
  (`POST {route, props} → {html, head}`) when it does.

## Built and verified

**Phase 1 — core manifest + Hand chain.**
`svelteModKind` / `svelteRouteFor` / `collectSvelteManifest` scan
`.svelte` siblings into URL patterns (dynamic segments verbatim).
Cross-extension double-claim (`foo.svelte` vs `foo/+page.*`) is a build
error. `.swelte/ssr-manifest.json` emitted per generate. `routes.js`
union covers svelte-only entries + `hydrateSwelteRoute()`. Nested
`*/+error.svelte` is a build error (generate + check parity). `Hand`:
slash-strip (pre-existing), `Accept: application/json` bypass (probes
unchanged), SSR attempt before static/SPA (reordered — static used to
win and SSR never ran when `dist/` existed). `swelte_fill_ssr` fills
`<!--ssr-head-->` / `<!--ssr-body-->` + tags `#app` with
`data-swelte-ssr="1"`; missing placeholders → shell unchanged.
`transformIndexHtml` injects markers into built `dist/index.html`
(source `src/app.html` never carries them in the built output).

**Phase 2 — `@swelte/ssr-qjs` compiler (real, not a stub).**
Per-route `generate: 'server'` compile, Rollup bundle to ESM,
tree-shaking drops the async branch. Two bundle-time shims
(`shims/svelte-crypto.js`, `shims/svelte-render-context.js`) substitute
the modules carrying lazy `node:` imports that never fire on the sync
path; upstream files named in each shim header for upgrade review.
Final bundle verified `node:`-free by `assertQjsCompatible` (fails the
build otherwise). Guards (all file+line): SDK imports allowed but
top-level stub *calls* rejected via Svelte AST walk
(`assertNoTopLevelStubCalls` — imports fine, handler/lifecycle calls
fine, setup-scope `stub()` → build error); top-level `await` left to
the Svelte compiler (already rejects both modes without
`experimental.async`). SDK imports rewritten to render-time
throw-stubs (bundle imports clean; never ship to browser — client
bundle is separate Vite build). `emitRenderJs` writes dev
(`.swelte/dev/render.js`) and prod (`dist/ssr/render.js`) bundles.
Sandbox proof: `/` renders full page HTML with markers, `/nope` falls
back to `+error`, 0 `node:` strings, ~73KB ESM.

**Phase 3 — `@[load]` cascade (typed, no JSON in `.v`).**
`@[load] name(req SwelteRequest[, parent T]) !R`. Level 0 takes
`(req)`; deeper levels take `(req, parent T)` where T is the previous
level's return struct (short or vType-prefixed spelling). Mismatch =
build error (layout contract, enforced). Harness threads typed values
root-first (`frag_0 → frag_1`), `json.encode` once at the edge.
`swelte_load_route()` (same precedence as `swelte_route`, api/*
excluded) + `swelte_load_for()` fan-out in `server_gen.v`.
`Hand` builds a GET `SwelteRequest` and calls the cascade for HTML
navigations only. Wrapper struct decls emitted (pre-existing gap:
inlined fns referenced structs whose decls were dropped). Sandbox
demo: wrapper `AdminLayout{section, org_id}` → leaf `AdminProps`
reads `parent.section` / `parent.org_id` typed. `v -o` clean.
Documented in `docs/rpc.md` (Attributes table + SSR component rule).

**Build/dev/preview wiring.**
`vite build` via the adapter's `generateBundle` emits
`dist/ssr/render.js` (proven: 73KB + marked `index.html` from real
builds). Single `v -o` (the throwaway typecheck compile was cut —
same errors, double the slowest step; cold builds still slow on V
stdlib, warm builds ~3s). Core smoke stays static/SPA + JSON;
adapter's `runSsrCheck` boots the sidecar and asserts HTML render +
markers (verified green). `swelte dev` stays core-only; adapter's
`runSsrDev` boots sidecar + delegates with `SWELTE_SSR_URL` wired.
Example `something` imports `swelte` from `@swelte/ssr-qjs`,
depends on it, `main.ts` is a user shim over the generated entry.

## Live proof (reproducible)

Sidecar + V with `SWELTE_SSR_URL` set: `/` returns the shell with
rendered `<main>` inside + `data-swelte-ssr="1"`; `/api/greet` stays
pure JSON; `/nope` → 404 `+error` HTML; `/admin` without cookie →
`load` throws → 4xx `+error` HTML. Server stays up throughout.

## Open, in order

1. **QJS link (prod).** Requires `qjsc`/`qjs` binaries. `qjsc -b -o
   render.qbc render.js` (or `-o render.c` for C embed), exactly one
   artifact in `dist/ssr/`. V side: embed (`embed_file` or
   `SWELTE_DIST`-adjacent read — same choice as WASM `app_lib`, keep
   consistent), `swelte_qjs_*` C-interop (fresh runtime+context per
   request or small pool), 50ms timeout → SPA fallback, 16MB cap, no
   `fs/net/process` shims. Binary delta budget <3MB. The Node sidecar
   then retires from prod paths (stays dev-only). Check `qjsc`
   availability first — everything else waits on it.
2. **Dev auto-sidecar UX.** `swelte dev` is core-only today; using SSR
   in dev means running the adapter's `runSsrDev` or hand-booting the
   sidecar + env var (see proof above). Decide: adapter CLI wrapper
   vs documented manual steps. Do not put engine startup in core.
3. **`ssr-bun` (opt-in).** Same `POST {route, props} → {html, head}`
   protocol against `SWELTE_SSR_URL`. Gets async/streaming/Suspense +
   npm compat. Explicitly opts out of single-artifact.
4. **§5 gate as CI.** 404 `+error` HTML, strip parity, JSON bypass,
   `!T` → 500 HTML + server up, bare-machine single artifact
   (post-QJS-link), dev HMR no-restart, bun streaming. `runSsrCheck`
   covers the sidecar half today.

## Traps for the next implementer

* `transformIndexHtml` only rewrites `/src/main.ts` references and only
  injects markers when `#app`/`</head>` exist — custom entries and
  shells pass through untouched (by design; entry-main shim covers it).
* `server.v` static branch must stay AFTER the SSR attempt (fixed once:
  static won and SSR never ran with `dist/` present).
* `inlineWrapperFns` only inlines fns — struct decls need the separate
  `wrapperStructDecls` emit (fixed once, will recur for new decl kinds).
* `resolveId` sees raw `./crypto.js` + importer, not the bare
  specifier — match resolved paths for shims.
* The bundle must be ESM for the sidecar (`import()`); IIFE assigns to
  a throwaway `exports`. QJS prod wants scripts/modules via `qjsc`,
  a different packaging question from dev ESM — do not conflate.
* `qjsc` availability gates everything in (1). Without it, SSR stays
  sidecar-bridged (dev/CI) and prod stays static/SPA.
