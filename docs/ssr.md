# SSR (record of built behavior)

Server-side rendering is proven. This page is the durable
record: what SSR does, how it runs, and the measured budgets.

## Ownership (locked)

* `core` is engine-agnostic and stays that way. It provides: the
  `.svelte` route manifest (`.swelte/ssr-manifest.json`), the `Hand`
  SSR hook (`swelte_ssr_enabled()` / `swelte_render_page()` /
  `swelte_page_props()` / `swelte_fill_ssr()` in the generated harness
  `.swelte/server.v`), marker
  injection in `transformIndexHtml`, the generated client entry
  (`.swelte/entry-main.ts`), and the `loadPage` client twin in `sdk.ts`.
  Core never imports `svelte/compiler`, QuickJS, or a JS runtime; core's
  `build`/`dev`/`preview` never start an engine. `SWELTE_SSR_URL` in the
  environment is the only bridge — `Hand` proxies when set, skips when
  not. Default is SPA/static + JSON, always.
* `@swelte/ssr-qjs` (optional engine — `npm install @swelte/ssr-qjs`) owns: the SSR compiler, the
  QuickJS prod embed (shared `@swelte/qjs` package — the vendored engine lives there as joint
  SSR+PTC infrastructure), the dev sidecar (Node HTTP, dev-only),
  and the CI gate (`runSsrCheck`). Dev needs no separate command:
  `swelte dev` auto-boots the sidecar when the adapter is installed
  (emits `.swelte/dev/render.js`, sets `SWELTE_SSR_URL` for `Hand`);
  `SWELTE_PLUGINS=@swelte/ssr-qjs` adds `swelte ssr-check`.
* Without the QJS package, core stays SPA/static + JSON: `swelte build` skips the bridge pass, `swelte preview` serves the shell, and `SWELTE_SSR=1` fails the V compile loudly (missing bridge symbol) instead of silently falling back.

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
* `.swelte/dev/render.js` — **dev**. Read by the sidecar
  (`SWELTE_SSR_URL`, booted by `swelte dev` when the adapter is
  installed), so Svelte edits HMR without a V restart.

Guards (build errors with file+line): no `node:` imports, no
`fetch(`, no top-level `await`, no top-level stub calls in
SSR-compiled components (QuickJS is pure-sync; `load()` stays in V).
Component guards inspect executable syntax: prose, literal markup, CSS, comments
and string contents are ignored, while template interpolation and markup
expressions are checked. Deferred event handlers remain allowed.
`.v` RPC stub imports become render-time throw-stubs (`#routes/*.v` /
`#lib/*.v` / `@swelte/core`,
`$app/stores|state|navigation`; `$app|#app/environment` + `$app|#app/paths`
resolve to server literals) — they never ship to the
browser (client bundle is a separate Vite build). Plain `#lib/*.js|ts|svelte`
source imports are NOT stubs: the SSR bundler resolves them from disk
(like the client's `#lib` alias). Unknown IDs
(`#app/secret`, `$app/forms`, `$env/*`) are not shimmed: build error.
## Request path

UI HTML requests and `X-Swelte-Load: 1` navigation requests share a guarded
load path, including pages with only Svelte components. Before hooks prepare
locals before loads; after hooks supply headers and cookies. Load redirects
are HTTP redirects for HTML, and encoded locations for navigation fetches.
Untyped load exceptions produce 500; the watchdog produces 504.

The versioned page envelope preserves wrapper levels, route identity, params,
status and form data. HTML embeds it in escaped inert `__swelte_page` JSON;
hydration consumes it before mounting. Wrapper and page components render in
one Svelte tree, preserving context and head output. Page state is request-local
in SSR. Universal sibling loads run root-first in both SSR and the browser
(synchronous only in QuickJS).

With `swelte.compat: 'sveltekit'`, props are `{ data, form, params }` and
`$app/state.page` exposes reactive URL, route, data and form values. Default
flat props and legacy stores remain available. Browser `invalidateAll()` awaits
the current page load and updates mounted props, preserving component state.
Universal loads can register tags with their supplied `depends(...tags)`
callback, including after an await on client-only loads. Navigation
`invalidate(tag)` awaits refresh when a current wrapper/page declares that
tag. The native SDK retains its synchronous matching-key return and schedules
refresh; `invalidateAsync(tag)` provides explicit completion there. This is
active-page invalidation, not a general data cache or predicate API.

`SWELTE_SSR_STRICT=1` rejects unexpected renderer fallback. A render exception
marks the error output so the native response returns 500. Browser fixtures
can set `globalThis.__swelteStrictHydration = true` to fail on hydration
mismatch; ordinary fallback emits `swelte:hydration-fallback`.

Native bridge diagnostics include the route and a bounded reason:
`timeout`, `memory-limit`, `output-limit`, `compile-or-load`, `missing-export`,
`exception`, `bundle-unavailable` or `runtime-unavailable`. They omit props,
credentials and exception bodies. Hand separately records caught render errors.
Strict mode turns unexpected renderer fallback into HTTP 500; default mode
retains the existing fallback behavior. Load watchdog timeouts are HTTP 504;
they bound the response wait and do not terminate the native load thread.

Set `SWELTE_SSR_DIAGNOSTICS=1` to include original QuickJS exception details in
native diagnostic output while investigating a server-side failure. Keep it
disabled for ordinary operation: client responses and the `@[report]` hook do
not expose original JavaScript stacks.

Body output grows from 64 KiB to at most 1 MiB; head output grows from 8 KiB
to at most 64 KiB (each buffer reserves one byte for NUL). Larger head/body
output fails explicitly instead of truncating HTML or dropping head metadata.
Native C tests exercise real timeout/OOM/exception returns and concurrent
bytecode-cache eviction; the HTTP fixture checks strict failures and recovery.

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

* A load envelope with 3xx status and `Location` redirects an HTML GET.
  Automatic no-JS form success redirects are a separate POST behavior.
* `Accept: application/json` bypasses SSR — API stays JSON (same
handler, content-negotiated). `curl` without a browser Accept and
bare `curl` probes see static/SPA + JSON, never SSR (build asserts artifacts only — booting is `swelte preview`).
* `swelte preview` auto-sets `SWELTE_SSR=1` when the QJS bridge
artifact exists (detection only — core never starts an engine).
Explicit `SWELTE_SSR` / `SWELTE_SSR_URL` in the env still win.
* `swelte dev` is bridge-aware: with the real bridge present, `v run`
gets the same `-enable-globals -cc <abs-gcc>` flags as the build (flags
go **before** `run`; after it V treats them as program argv).
Core-only projects compile against generate()'s no-op bridge stub (same
symbol, returns not-ok — SSR falls through to the sidecar proxy); plugin
V modules (core's `{hub,ws}.v` transport gate, third-party plugin includes) add `-enable-globals`
via the `.swelte/plugin_modules.json` marker generate() writes.
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

Place `+error.svelte` in any route directory, with props
`{ status?: number; message?: string }`. SSR, hydration, navigation and action
errors select the nearest boundary in the matched page's physical ancestry,
including route groups. A boundary retains wrappers strictly above its own
directory and replaces that directory's wrapper and page. Successful native
parent loads remain available to those wrappers; failed universal loads are
not rerun while rendering an error.

If a boundary or one of its retained wrappers throws, rendering tries the next
ancestor boundary. SSR records the selected boundary so hydration adopts the
same tree even when a nearer boundary failed on the server. Unknown URLs use
matching ungrouped directory scopes (including dynamic segments), then the root
boundary; grouped scopes require a matched page. Error components are imported
eagerly in the client, independently of page chunking and layout resets.

Native load/action errors retain their status. Page render failures produce a
sanitized 500. Missing or failed boundaries preserve the existing shell fallback;
JSON/API responses continue to use their error envelope.

## Measured budgets (`examples/something`, 73KB bundle)

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

`swelte ssr-check` (via `SWELTE_PLUGINS=@swelte/ssr-qjs`) is a runnable
gate for local or CI use. Its child V processes run in isolated process
groups so their compiled server children are stopped too; the
`ssr-check` plugin test verifies the gate passes on a stub render.js.
The command can skip Hand or embedded-production
probes when the corresponding build artifacts are absent. This repository's
test script does not currently invoke the command as a separate CI job.

## Current limits and architecture

* No React/Vue adapters in core — `core` lists `.svelte` because
Swelte is Svelte.
* No async in the qjs renderer — streaming SSR is a non-goal.
* No `core` dependency on `svelte/compiler`, `quickjs`, or a JS runtime.
* QJS bytecode cache (proven, no `qjsc` binary needed): the glue
compiles `render.js` once per distinct bundle bytes (`JS_Eval` +
`JS_WriteObject(BYTECODE)` on a throwaway runtime, FNV-1a key + length
in a ring of 4) and reuses it across renders (`JS_ReadObject` +
return-the-module — the driver import resolves/links/evals exactly
once; the loader must NOT pre-eval or the link assertion fires).
Compile failure → source path, same render. See `engine/qjs/c/swelte_qjs.c`
`swelte_qjs_ensure_bytecode` / `swelte_qjs_loader` (the shared QuickJS
package lives in `engine/qjs/` (`@swelte/qjs`) — joint SSR+PTC infrastructure, see the
[AI spec](specs/ai.md) Phase C). `qjsc` the binary
remains unvendored and unnecessary.
