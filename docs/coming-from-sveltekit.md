# Coming from SvelteKit

Swelte keeps Svelte 5 on the frontend and replaces the Node backend with V
(native binary). File names look familiar on purpose — but the runtimes,
data flow, and a few conventions differ. This page lists every difference
that bites during migration. Only built behavior is documented here; open work lives in `specs/`.

## Files

| SvelteKit | Swelte | Notes |
|---|---|---|
| `+page.svelte` | `+page.svelte` | Same. Component per URL leaf. |
| `+page.ts` / `+page.server.ts` | `+page.v` (`@[load]`) + `+page.ts` (universal) | Server-only `load` = HTML-navigation initial paint (`parent T` param replaces `parent()`); universal sibling `load({ params, props, url })` = sync view-model transform inside `renderRoute` (typed TS — ssr-qjs transpiles via `transpileSiblingLoad`, mirror of the `.svelte` `generate: 'server'` step; async only when `ssr=false`). |
| `+layout.svelte` | `+route.svelte` | Wrapper per subtree (nav + chrome), Svelte 5 `children` Snippet + `{@render children?.()}` outlet (not slots). SPA mount nests automatically; SSR `renderRoute` composes the chain server-side; client `hydrateSwelteRoute` hydrates the whole chain in place (SSR DOM adopted, leaf interactive; mismatch falls back to mount). |
| `+layout.server.ts` | `+route.v` (`@[load]`) | Same cascade position. Level 0 takes `(req)`; deeper takes `(req, parent T)` — typed parent value instead of `await parent()`. Mismatch is a build error. |
| `+server.ts` | `SwelteResponse` in the leaf `.v` | No standalone file. `@[get]`/`@[post]`/`@[put]`/`@[patch]`/`@[delete]` on the route file; one default per verb, `?q` qualifiers for many-per-file. Returns `string`/struct (JSON), `[]u8` (binary), `(int, string)` (status+text), or `SwelteResponse{ status, headers, cookies, body/body_bytes }` — full header/cookie/status/binary control, translated 1:1 into veb by `Hand`. |
| `+error.svelte` (per-dir) | single global `+error.svelte` | By design — no per-directory inheritance. Props `{ status?, message? }`, renders server-side and client-side (via `loadPage`). |
| `params/*.ts` matchers | `src/matchers.v` `@[matcher]` | Central file, V-only + codegen'd JS mirrors. `[id=integer]` builtin (digits, `Params` narrows to `number`); custom `@[matcher] (s string) bool` fns in the portable subset inline into `swelte_matcher_check` + both JS mirrors. Unknown name / bad shape / `time\|os\|net` import = build error. |
| `hooks.server.ts` | `+route.v` `@[before]`/`@[after]` + `src/app.v` | Subtree middleware stays in `+route.v`; root `+route.v` is already the global head. `src/app.v` (`@[startup] () void|!void` once before `veb.run`, zero/one fn, no qualifier/params; `@[reroute](host, path)` to rewritten path or empty string, zero/one fn, no qualifier) handles boot + rewrite; `@[cron('60s'|'5m'|'1h')]` ticks (one-or-more fns, qualifier required) run on spawn loops (→ `specs/app.md`). No `handle/handleFetch/handleError`; `transformPageChunk` = `@[after]` string rewrite. |
| `src/lib/server/*` | `src/lib/**/backend/*.v` or `*_backend.v` | Physical: backend-only files are a build error from browser/`#lib/` WASM imports. Same V compiles native + WASM for non-backend `#lib/`. |
| `+page.v` naming | `+page.v` / legacy `index.v` (optional — `+page.svelte` alone renders) | `foo/+page.v` (or `foo/index.v`) claims `/foo` for the API dispatcher (verbs/`@[rpc]`/`@[load]`). `foo.v` + `foo/+page.v` together is a build error (one file per URL). |

## Routing

* **The route IS the file path:** `src/routes/api/greet.v` → `/api/greet`.
  Only wrappers use `+` (`+route.v`/`+route.svelte`, `+page.v`, `+error.svelte`).
* **Route groups `(group)`** — disk-only folders, stripped from URL.
  No layout-reset magic beyond the strip; wrapping stays explicit.
* **Optional `[[slug]]`** — last-segment only, zero-or-one.
* **Matchers `[id=matcher]`** — `[id=integer]` builtin (digits-only,
  enforced both sides, `Params` narrows to `number`); custom
  `@[matcher]` fns in `src/matchers.v` (portable subset) inline into
  `swelte_matcher_check` + both JS mirrors. Unknown name / bad shape =
  build error.
* **`trailingSlash`** in `svelte.config.js` (`swelte` key) + env wins.
  Server 301s + stub URL normalization. Default `ignore`.
* **Dynamic wrapper dirs unsupported**: no brackets in `+route.v` paths.
* **`.svelte` and `.v` match independently** (HTML vs JSON never conflict).
* **`reroute`** — `src/app.v` `@[reroute](host string, path string) string` runs
  after `trailingSlash` normalization, before CORS/static/dispatch
  (`''` = no-op). Must be pure + fast.

## Data loading

* `@[load]` is **server-only, HTML-navigation only** (initial paint).
  Interaction data comes from stubs (`@[get]`/`@[rpc]` in handlers).
  Components must not call stubs at top level during SSR (build error) —
  move load-time data into `$props()`, keep stubs for handlers.
* Universal load: sibling `<basename>.ts` (`admin.ts` for `admin.svelte`,
  `+page.ts` for `+page.svelte`, typed — ssr-qjs transpiles with
  `transpileSiblingLoad`, the mirror of the `.svelte`
  `generate: 'server'` preprocessing step, so annotations never reach
  the QJS bundle; JSDoc-only `.js` still accepted as fallback)
  exporting `load({ params, props, url })` runs inside sync
  `renderRoute` before render; return merges into the
  component props. Sync-only when SSR is on (`fetch`/`await`/`node:`/SDK
  imports are build errors — move fetches to `@[load]` in the `.v`).
  `export const ssr = false` opts the route out (async load allowed,
  client-only). File pairing in `coming-from-sveltekit.md#Files`:
  `admin.v` (API+`@[load]`) + `admin.ts` (universal) + `admin.svelte`.
* No `parent()` — the parent value arrives as a typed fn param.
* Cache tags: `depends(...tags)` inside a load registers tags;
  `invalidate(...tags)` clears matching load keys, `invalidateAll()`
  clears all (`sdk.ts`, client-side).
* Client router (history-driven, entry-main boots `initSwelteRouter`):
  link-click interception + `popstate`; `goto(url, { replaceState?,
  noPreload? })`, `preloadData(url)` (JSON probe, no DOM write),
  `pushState(url, state)`; `beforeNavigate` (cancellable via `cancel()`),
  `afterNavigate`/`onNavigate`; `page`/`navigating`/`updated` stores.
  `page` shape: `{ url, params, route, data?, error? }`.
  Client mounts merge preloaded JSON into leaf props automatically
  (`{ params, ...data }`, same shape as SSR props).
* Server `fetch` in `load`: `swelte_fetch(req, mut out_cookies, method,
  path, body, content_type, qualifier)` dispatches sibling routes
  in-process (no loopback socket), forwards `Cookie`/`Authorization`
  (+`x-user`), returns `SwelteFetchOut{ status, body, headers }`, merges
  `Set-Cookie` into the out list. V-only (never projected to TS/WASM).

## Forms

* Verbs + `?q` qualifier replace `actions{}`: `<form action="?delete">`
  → `@[post('delete')]`.
* No-JS: browser `Accept: text/html` POST → `303` + `Location` on
  success, rendered HTML error on failure. Fetch (`Accept:
  application/json`) keeps JSON. Same handler, content-negotiated.
* No `fail(422, {fieldErrors})` helper — convention is
  `{ ok: false, fieldErrors: map[string]string }` thrown as `!T` +
  `sdk.ts isFail(e, status?)` narrowing.
* `use:enhance` / `applyAction` progressive-enhancement cycle (see
  `forms.md`): no-JS untouched (`303` / error page), with-JS replays
  as `fetch` + folds into `page.form` (`failure` stays inline, never
  `page.error`).

## Rendering

* SSR is runtime-only: embedded QuickJS (`SWELTE_SSR=1`) or sidecar
  (`SWELTE_SSR_URL`), 50ms/16MB budgets, fallback to SPA shell.
  Default is SPA/static + JSON; SSG is additive (`prerender.entries`
  → `dist/*.html`, root shell never overwritten — see `config.md`).
* Per-route `ssr=false`-lite: `export const ssr = false` in the
  sibling `.ts` opts the route out — `Hand` skips the renderer
  (`swelte_no_ssr()`), serves the SPA shell; async universal `load`
  + client router take over. No `csr=false` islands.
* Service worker: opt-in (`swelte.serviceWorker.enabled` or
  `SWELTE_SW=1`) → additive `dist/sw.js`, auto/manual register —
  see `config.md` §Service worker. Offline fallback page
  (`offline.fallback`) precached when the prerender pass wrote it;
  API/SSE stay network-only.
* ISR-lite: `swelte.isr` (`{ '/blog': 60 }` → `SWELTE_ISR`) stamps
  `Cache-Control: public, max-age=0, s-maxage=N` +
  `X-Swelte-Revalidate` on matching GET HTML. Headers only.
* Deploy targets: `--target` / `swelte.target` (`auto`|`static`|`node`|
  `edge`) — packaging-only shims (`dist/.swelte-static`,
  `dist/Dockerfile.swelte`, `dist/_headers`). Single artifact holds.
* `swelte export` snapshots the crawl (`entries.json` + `dist/*.html`
  + contract → `snapshot/`).
* `entries.ts` sibling (`export function entries()`) expands dynamic
  segments for the crawl when `prerender.entries: 'all'`.
* Per-route `Params` types generated (`RouteId` + `Params` in every
  `types/routes/*.d.ts`) — the `$types`-lite.

## Platform / config

* Aliases are `#routes` / `#lib` (hash, current SvelteKit style), not
  `$lib`. `#app/paths` + `#app/environment` virtual stubs generated
  from config. `$app/stores` + `$app/state` re-export
  `page`/`navigating`/`updated` from `@swelte/core`;
  `$app/navigation` re-exports
  `goto`/`preloadData`/`pushState`/`beforeNavigate`/`afterNavigate`/`onNavigate`.
  No `$app/forms`, no `$env/static|dynamic/*`.
* Streaming: client bundles compile with
  `compilerOptions.experimental.async` (see `templates/base/vite.config.ts`),
  so `<await>` Suspense resolves in the browser. SSR stays sync
  (ssr-qjs `generate: 'server'`, no async) — the SSR compile pass rejects
  top-level `await`/`fetch` with file+line.
* `svelte.config.js` `swelte` key holds: `routesDir`, `libDir`,
  `outDir`, `distDir`, `port`, `corsOrigin`, `trailingSlash`, `base`,
  `assets`, `csp`, `csrf`, `methodOverride`, `version`,
  `serviceWorker` (`{ enabled, register }` → additive `dist/sw.js`,
  `SWELTE_SW=1` forces on), `prerender` (`{ entries, concurrency }`),
  `isr`, `target`, `offline` (`{ fallback }`). Env wins at
  runtime (`SWELTE_*`), defaults when unset/invalid.
* `CSP` injected as meta, `CSRF` origin-check, `_method` override,
  `X-Swelte-Version` header.
* `HEAD` auto-handled on `GET` arms; `OPTIONS` is CORS-preflight-only
  (no `Allow:`-on-405 listing).
* Errors: `SwelteRpcError` (`status`, `body`, `base`, `fn`) replaces
  thrown `error()`/`json()` helpers; `loadPage()` maps load-time
  failures to `+error` props. `locals map[string]string` threaded
  through dispatch + `swelte_cookie_get/set/delete` helpers.
* Single artifact: `dist/server` + `dist/`. No Node at runtime.

