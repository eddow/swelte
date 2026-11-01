# Sveltekit equivalence

## State

In `swelte` today (`engine/core` + `docs/{rpc,types,errors,ssr,example}.md` + `examples/something`):

> Built: `src/routes/**/*.v` file-route RPC (`+page.v->/`,`api/*.v->/api/*`,`[id]`,`[...rest]`), verbs `get/post/put/patch/delete` + `@[rpc]` many-per-file + `@[sse]` streaming + `@[load]` cascade + `@[before]/@[after]` in `+route.v`, `SwelteRequest{query,form,files,headers,cookies,params,method,path,qualifier}`, `303` no-JS forms, global `+error.svelte`, QuickJS runtime SSR (`render.js`+`Hand`), V->TS projection, `SwelteRpcError`/`loadPage`.

What it lacks vs. full `SvelteKit`:

### 1. Routing
* No route-groups `(group)` — layout reset without URL segment.
* No optional `[[slug]]`, no matchers `[id=integer]`.
* No `+server.ts`-style standalone `Response` endpoints: verbs return `string/struct`, `@[after](req,code,body)->(code,body)` only — no `headers/set-cookie/stream/redirect` control.
* No `reroute`, `trailingSlash`, `strict` config.
* `+route.svelte` is manual composition, not nested `<slot/>/children` inheritance.

### 2. Data-loading / client-router
* `@[load]` is server-only, HTML-navigation only. No universal `+page.ts` load. Note: like in sveltekit, *can* be `async` *only* when `ssr = false`.
* No `parent()`, `depends()/invalidate()/invalidateAll()`, no streaming `Promise` + `<await>` Suspense.
* No client router: no `goto(), preloadData(), pushState(), beforeNavigate/afterNavigate/onNavigate`, no `navigating/page/updated` stores (`$app/navigation|stores|state`).
* No server `fetch` wrapper with cookie/auth forwarding in `load`.

### 3. Forms/Actions
* Has verb `POST ?q` + `303 Location` + HTML-escaped error, but no named `actions{save,delete}`, no `fail(422,{fieldErrors})`, no `use:enhance/applyAction/deserialize` progressive-enhancement cycle.

### 4. Layouts/Errors/Hooks
* Single global `+error.svelte{status,message}` by design — no per-directory `+error` inheritance/bubbling.
* No `+layout(.server).ts` data merging, no layout reset via groups.
* Subtree `@[before]/@[after]` only — no global `hooks.server.ts: handle/handleFetch/handleError/init/transformPageChunk`, no `event.locals`, no `cookies.get/set/delete` signed API.

### 5. Rendering modes
* No per-route `export const ssr/csr/prerender=true|false`, no `entries/prerender-crawl`, no SSG/ISR, no `adapter-static/node/auto/edge`.
* SSR is runtime-only (`SWELTE_SSR=1` embedded QuickJS/`SWELTE_SSR_URL` sidecar, `50ms/16MB` fallback to SPA shell) — never emits prerendered `.html` files.
* No `csr=false` islands, no hydration directives.

### 6. Platform DX
* No `$app/paths(base/assets)`, `$app/environment`, `$app/forms`, `$env/static/private|dynamic/private`, `$lib/server` env contract — Swelte uses physical `#lib/backend|*_backend.v` + `PORT/SWELTE_DIST/SWELTE_CORS_ORIGIN/SWELTE_BODY_LIMIT/RATE_LIMIT/HANDLER_TIMEOUT_MS`.
* No `CSP/CSRF/methodOverride/version` kit config, no `service-worker`, no `snapshot` export, no `svelte-check` `$types{Params,ServerLoad,Actions}` generics — Swelte generates flat `types/routes/*.d.ts{Struct,Result,fn(args)}`.

## Roadmap

### 1. Trivial — implementable with no architectural question

Status: all 9 implemented.

Additive only: no change to locked invariants (single global `+error.svelte`,
core engine-agnostic, Hand+dispatcher ownership, `@[load]` server-only,
`#routes/` fetch vs `#lib/` WASM split, single-artifact `dist/server`,
SPA-first proxy rule). Each item is a contained diff in
`engine/core/src/vite.ts` (`routeFor`/`svelteRouteFor`/`validateDynamicSegs`/
`routeParams`/`tsTypeFor`/stub emitters), `gen/diagnostics.ts`,
`templates/harness/server.v` (env-driven Hand), `sdk.ts`, or docs.

1. **Route groups `(group)` — strip from URL, keep on disk.** DONE.
   What: `(admin)/users/+page.v` -> `/users`, not `/(admin)/users`.
   Implemented: `stripRouteGroups()` in `vite.ts`; used in `routeFor`,
   `svelteRouteFor`, claim-check; unit-tested (`route-helpers.test.ts`).
   Manifest keeps the full mod for `+route.v` scoping. Wrapping stays
   explicit/manual (no layout-inheritance change).

2. **Optional params `[[slug]]`.** DONE.
   Implemented: `validateDynamicSegs` accepts last-segment `[[slug]]`,
   `routeFor` passes through, V `swelte_match_route` matches zero-or-one
   (`params['slug']=''` on empty), client `matchSegs` + `__swelteUrl`
   handle it, clash-check distinguishes `[?]` shape. Tested in
   `route-helpers.test.ts` + live `users/42` probe.

3. **`trailingSlash` config (`'always'|'never'|'ignore'`).** DONE.
   Implemented: `SwelteOptions.trailingSlash` + `SWELTE_TRAILING_SLASH`
   env wins; server 301s in `Hand.before_request`, TS `__swelteUrl`
   normalizes via baked `__swelteTrailing`; `dev`/`build`/`preview`
   forward config→env. Default `ignore`. Verified `301 /api/greet → /api/greet/`.

4. **Per-route `Params` types (`$types`-lite).** DONE.
   Implemented: every `types/routes/*.d.ts` starts with
   `export type RouteId` + `export interface Params`. Tested
   (`route-helpers.test.ts` asserts `/users/[id]`).

5. **`#app/paths` + `#app/environment` virtual stubs.** DONE.
   Implemented: `.swelte/paths.js`, `.swelte/environment.js` (+ `.d.ts`
   for types) generated from `loadConfig()`; `#app/paths` + `#app/environment`
   declared in `v-shim.d.ts`, wired via `resolve.alias`. No V side.

6. **CSP + CSRF + `methodOverride` knobs.** DONE.
   Implemented: `SwelteOptions.csp/csrf/methodOverride` + `SWELTE_CSP`,
   `SWELTE_CSRF_CHECK_ORIGIN`, `SWELTE_METHOD_OVERRIDE` env wins;
   `transformIndexHtml` injects the CSP meta, `Hand` enforces origin +
   `_method` dispatch. `dev`/`build`/`preview` forward config→env.

7. **`SwelteRequest.locals` + cookie helpers (V-side sugar).** DONE.
   Implemented: `locals map[string]string` threaded `server_gen.swelte_route`
   → `dispatch` → verbs/`load`/`swelte_req` (incl. `load_for`), projected
   into TS `SwelteRequest`; `swelte_cookie_get/set/delete` helpers emitted.
   `before_request` passes empty locals today (middleware can fill it).

8. **`HEAD`/`OPTIONS` auto-handling.** DONE (shape adjusted).
   Implemented: `GET` verb arm also matches `HEAD` (same handler, veb sends
   headers; body present but `curl -I` reports `size=0`), CORS preflight
   `Allow-Methods` line gains `HEAD`. OPTIONS stays CORS-preflight-only
   (the SvelteKit `Allow:`-on-405 listing was dropped — `Hand` returns JSON
   envelope, not per-prefix headers; codegen already knows handlers per
   prefix and a future pass can re-add it). Tested (`route-helpers.test.ts`
   asserts the `GET || HEAD` arm + live `HEAD / → 200`, `DELETE / → 405`).

9. **`version` + `name` stamping.** DONE.
   Implemented: `.swelte/version.js` (`version` from `svelte.config.js` or
   `package.json`, + `buildTime` ISO) + `SWELTE_VERSION` env forwarded by
   `dev`/`build`/`preview`; `Hand` emits `X-Swelte-Version` when set.
   Golden tests exclude `version.js` bytes (wall-clock) but pin version pin.

