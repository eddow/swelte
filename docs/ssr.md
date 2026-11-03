# SSR (record of built behavior)

Server-side rendering is proven. This page is the durable
record: what SSR does, how it runs, and the measured budgets.
Open work (`ssr-bun`, gate-as-CI with wrapper-route asserts) stays in
`specs/ssr.md`.

## Ownership (locked)

* `core` is engine-agnostic and stays that way. It provides: the
  `.svelte` route manifest (`.swelte/ssr-manifest.json`), the `Hand`
  SSR hook (`swelte_ssr_enabled()` / `swelte_render_page()` /
  `swelte_page_props()` / `swelte_fill_ssr()` in the generated harness
  `.swelte/server.v`), marker
  injection in `transformIndexHtml`, the generated client entry
  (`.swelte/entry-main.ts`), and the `loadPage` client twin in `sdk.ts`.
  Core never imports `svelte/compiler`, QuickJS, or bun; core's
  `build`/`dev`/`preview` never start an engine. `SWELTE_SSR_URL` in the
  environment is the only bridge — `Hand` proxies when set, skips when
  not. Default is SPA/static + JSON, always.
* `@swelte/ssr-qjs` (optional engine — `npm install @swelte/ssr-qjs`) owns: the SSR compiler, the
  vendored QuickJS prod embed, the dev sidecar (Node HTTP, dev-only),
  and its own lifecycle commands (`runSsrDev`, `runSsrCheck`).
* `@swelte/ssr-bun` (opt-in) does not exist yet. Same HTTP protocol
  (`POST {route, props} → {html, head}`) when it does.
* Without the package, core stays SPA/static + JSON: `swelte build` skips the QJS bridge pass, `swelte preview` serves the shell, and `SWELTE_SSR=1` fails the V compile loudly (missing bridge symbol) instead of silently falling back.

## How it works

One `render.js` per app, all routes inside. The adapter compiles each
`.svelte` page with Svelte's `generate: 'server'`, bundles them with
the Svelte server runtime into a single IIFE exporting
`renderRoute(route, props_json) -> { head, body }`, dispatched by a
route table (`ROUTES[route]`). Data (`props_json`) is built per
request by V from `@[load]` fns — never baked in. Unknown route →
`+error.svelte`; total render miss → `<!--ssr-body-->` survives and
the client hydrates/fetches instead. Never blank.

Two copies of the same bundle:

* `dist/ssr/render.js` — **prod**. Read at runtime by the V binary
  (embedded QuickJS, `SWELTE_SSR=1`); exactly one artifact in
  `dist/ssr/`.
* `.swelte/dev/render.js` — **dev**. Read by the `swelte-ssr dev`
  sidecar (`SWELTE_SSR_URL`), so Svelte edits HMR without a V restart.

Guards (build errors with file+line): no `node:` imports, no
`fetch(`, no top-level `await`, no top-level stub calls in
SSR-compiled components (QuickJS is pure-sync; `load()` stays in V).
`.v` RPC stub imports become render-time throw-stubs (`#routes/*.v` /
`#lib/*.v` / `@swelte/core`,
`$app/stores|state|navigation`; `$app|#app/environment` + `$app|#app/paths`
resolve to server literals) — they never ship to the
browser (client bundle is a separate Vite build). Plain `#lib/*.js|ts|svelte`
source imports are NOT stubs: the SSR bundler resolves them from disk
(like the client's `#lib` alias). Unknown IDs
(`#app/secret`, `$app/forms`, `$env/*`) are not shimmed: build error.
## Request path

Browser `GET /` (`Accept: text/html`) → `Hand.before_request` →
`swelte_ssr_enabled()` (HTML navigation, V route 200, `SWELTE_DIST`
set) → `swelte_page_props()` (`swelte_load_for()` cascade) →
embedded QuickJS `renderRoute(path, props)` (or sidecar POST when
`SWELTE_SSR_URL` is set) → HTML injected at `<!--ssr-body-->` +
`data-swelte-ssr="1"` on `#app` for hydration. The client entry
hydrates the full wrapper chain in place (`hydrateSwelteRoute`: one
top-level `hydrate()` of the outermost `+route.svelte`, each level's
`children` snippet invoking the inner component on the snippet anchor —
SSR DOM adopted, leaf interactive; mismatch → mount fallback). Failures
(no bundle, throw, timeout, OOM, too-big) → SPA shell / `+error` HTML —
never blank/JSON for navigations.

* `GET` navigations never redirect (§12 `303` is POST-only).
* `Accept: application/json` bypasses SSR — API stays JSON (same
handler, content-negotiated). `curl` without a browser Accept and
the `swelte build` smoke probe see static/SPA + JSON, never SSR.
* `swelte preview` auto-sets `SWELTE_SSR=1` when the QJS bridge
artifact exists (detection only — core never starts an engine).
Explicit `SWELTE_SSR` / `SWELTE_SSR_URL` in the env still win.
* `swelte dev` is bridge-aware: with the bridge present, `v run` gets
the same `-enable-globals -cc <abs-gcc>` flags as the build (flags
go **before** `run`; after it V treats them as program argv).
Conda-safe: absolute cc + conda-free PATH (conda's `ld` shadows
the system linker).

## `@[load]` cascade

Initial paint data comes from a `load` fn; interaction data comes
from stubs. `@[load] name(req SwelteRequest[, parent T]) !R` — zero
or one per `.v` file, never stacked with a verb/rpc/sse, no
qualifier. Level 0 takes `(req)`; deeper levels take `(req, parent
T)` where T is the previous level's return struct. `Hand` threads
typed values root-first (`frag_0 → frag_1`), `json.encode` once at
the edge → `props_json`. Throw → `+error` props with status.
Full rule: `internal/load.md`; contract: `rpc.md`.

## `+error` contract

Single global `src/routes/+error.svelte`, props
`{ status?: number; message?: string }`. Same file renders
server-side and client-side (via `loadPage()` mapping `SwelteRpcError`
→ `{ error: { status, message } }`). 404 unknown path, 4xx guard
rejects (`/admin` without cookie → 400), 500 handler throws — all
HTML with the right status, server stays up. Missing `+error.svelte`
→ SPA `index.html` 200 (back-compat).
## Measured budgets (2026-10-31, `examples/something`, 73KB bundle)

* `renderRoute('/')` in-process (Node, same bundle the binary embeds):
200 renders in 2.4ms total → **~0.012ms/render**. Pure string
concat + Svelte server runtime; no I/O, no fetch, no event loop.
* End-to-end browser `GET /` against `dist/server` (`SWELTE_SSR=1`,
loopback): **~3–12ms** wall (`curl time_total`, cold→warm),
`/nope` 404 `+error` ~3ms, `/admin` 400 ~5ms, JSON API ~0.4ms.
V per-request cost (QuickJS fresh runtime + context, module eval of
the 73KB bundle, `load()` cascade, HTTP stack) dominates the render
itself by ~2 orders of magnitude — the 50ms timeout budget is
~4–15× observed p-cold, and the 16MB cap is ~200× the bundle.
* Binary delta (vendored QuickJS + glue, `libqjs.a` + C bridge):
+~1MB (5.1MB → 6.1MB).

Design constraints (V 0.5.2): the C glue never returns malloc'd
pointers (autofree would double-free) — V passes a 64KB→1MB stack
buffer, C copies the body HTML in and reports the needed length;
runtimes are C-side int handles (V truncates u64 C values); `free()`
always from C, never `C.free()` from V.

## Gate

`runSsrCheck` (`@swelte/ssr-qjs/cli`) asserts three halves with the
same browser-shape expectations (`<main>`, `data-swelte-ssr="1"`,
no `<!--ssr-body-->` leftover, JSON bypass intact):

1. sidecar direct (`POST {route, props}`),
2. sidecar-via-Hand (real V backend + `SWELTE_SSR_URL`),
3. prod binary (`dist/server` + `SWELTE_SSR=1`, the `preview` path),

plus exactly one artifact in `dist/ssr/` and a 20× repeat-render
(no crash, stable timing). Verified green.

## Non-goals (locked)

* No per-directory `+error` inheritance (single global).
* No React/Vue adapters in core — `core` lists `.svelte` because
Swelte is Svelte.
* No async in the qjs renderer (use `bun` if you need it).
* No `core` dependency on `svelte/compiler`, `quickjs`, or `bun`.
* QJS bytecode cache (proven, no `qjsc` binary needed): the glue
compiles `render.js` once per distinct bundle bytes (`JS_Eval` +
`JS_WriteObject(BYTECODE)` on a throwaway runtime, FNV-1a key + length
in a ring of 4) and reuses it across renders (`JS_ReadObject` +
return-the-module — the driver import resolves/links/evals exactly
once; the loader must NOT pre-eval or the link assertion fires).
Compile failure → source path, same render. See `c/swelte_qjs.c`
`swelte_qjs_ensure_bytecode` / `swelte_qjs_loader`. `qjsc` the binary
remains unvendored and unnecessary.
