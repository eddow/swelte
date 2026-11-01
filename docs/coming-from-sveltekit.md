# Coming from SvelteKit

Swelte keeps Svelte 5 on the frontend and replaces the Node backend with V
(native binary). File names look familiar on purpose — but the runtimes,
data flow, and a few conventions differ. This page lists every difference
that bites during migration. Only built behavior is documented here; open work lives in `specs/sveltekit.md` and `specs/moar.md`.

## Files

| SvelteKit | Swelte | Notes |
|---|---|---|
| `+page.svelte` | `+page.svelte` | Same. Component per URL leaf. |
| `+page.ts` / `+page.server.ts` | `+page.v` (`@[load]`) | Server-only `load`, HTML-navigation initial paint. No universal `load`. `parent T` param replaces `parent()`. |
| `+layout.svelte` | `+route.svelte` | Wrapper per subtree (nav + chrome), Svelte 5 `children` Snippet + `{@render children?.()}` outlet (not slots). SPA mount nests automatically; SSR `renderRoute` composes the chain server-side; client `hydrateSwelteRoute` hydrates the whole chain in place (SSR DOM adopted, leaf interactive; mismatch falls back to mount). |
| `+layout.server.ts` | `+route.v` (`@[load]`) | Same cascade position. Level 0 takes `(req)`; deeper takes `(req, parent T)` — typed parent value instead of `await parent()`. Mismatch is a build error. |
| `+server.ts` | `SwelteResponse` in the leaf `.v` | No standalone file. `@[get]`/`@[post]`/`@[put]`/`@[patch]`/`@[delete]` on the route file; one default per verb, `?q` qualifiers for many-per-file. Returns `string`/struct (JSON), `[]u8` (binary), `(int, string)` (status+text), or `SwelteResponse{ status, headers, cookies, body/body_bytes }` — full header/cookie/status/binary control, translated 1:1 into veb by `Hand`. |
| `+error.svelte` (per-dir) | single global `+error.svelte` | By design — no per-directory inheritance. Props `{ status?, message? }`, renders server-side and client-side (via `loadPage`). |
| `params/*.ts` matchers | `src/matchers.v` `@[matcher]` | Central file, V-only + codegen'd JS mirrors. `[id=integer]` builtin (digits, `Params` narrows to `number`); custom `@[matcher] (s string) bool` fns in the portable subset inline into `swelte_matcher_check` + both JS mirrors. Unknown name / bad shape / `time\|os\|net` import = build error. |
| `hooks.server.ts` | `+route.v` `@[before]`/`@[after]` + `src/server.v` | Subtree middleware stays in `+route.v`; root `+route.v` is already the global head. `src/server.v` (`@[startup]` once before `veb.run`, `@[reroute](host, path)` to rewritten path or empty string) handles boot + rewrite; `@[cron]`/`@[queue]` are open (→ `specs/moar.md`). No `handle/handleFetch/handleError`; `transformPageChunk` = `@[after]` string rewrite. |
| `src/lib/server/*` | `src/lib/**/backend/*.v` or `*_backend.v` | Physical: backend-only files are a build error from browser/`#lib/` WASM imports. Same V compiles native + WASM for non-backend `#lib/`. |
| `+page.v` naming | `+page.v` / legacy `index.v` | `foo/+page.v` (or `foo/index.v`) claims `/foo`. `foo.v` + `foo/+page.v` together is a build error (one file per URL). |

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
* **`reroute`** — `src/server.v` `@[reroute](host, path) string` runs
  after `trailingSlash` normalization, before CORS/static/dispatch
  (`''` = no-op). Must be pure + fast.

## Data loading

* `@[load]` is **server-only, HTML-navigation only** (initial paint).
  Interaction data comes from stubs (`@[get]`/`@[rpc]` in handlers).
  Components must not call stubs at top level during SSR (build error) —
  move load-time data into `$props()`, keep stubs for handlers.
* No `parent()` — the parent value arrives as a typed fn param.
* No `depends()`/`invalidate()`/`invalidateAll()`, no `goto()`/
  `preloadData()`/`pushState()`, no `beforeNavigate`/`afterNavigate`/
  `navigating`/`page`/`updated` stores. No client router beyond
  mount/hydrate by pathname.
* No server `fetch` wrapper with cookie/auth forwarding in `load`.
* Async `load` only when SSR is off (same rule as SvelteKit).

## Forms

* Verbs + `?q` qualifier replace `actions{}`: `<form action="?delete">`
  → `@[post('delete')]`.
* No-JS: browser `Accept: text/html` POST → `303` + `Location` on
  success, rendered HTML error on failure. Fetch (`Accept:
  application/json`) keeps JSON. Same handler, content-negotiated.
* No `fail(422, {fieldErrors})` helper — convention is
  `{ ok: false, fieldErrors: map[string]string }` thrown as `!T` +
  `sdk.ts isFail(e, status?)` narrowing.
* No `use:enhance`/`applyAction` cycle yet — only the `deserialize`
  port exists (pure TS in `sdk.ts`, no client router needed).

## Rendering

* SSR is runtime-only: embedded QuickJS (`SWELTE_SSR=1`) or sidecar
  (`SWELTE_SSR_URL`), 50ms/16MB budgets, fallback to SPA shell.
  Never emits prerendered `.html`. Default is SPA/static + JSON.
* No per-route `ssr`/`csr`/`prerender` flags — `ssr=false`-lite is open
  (→ `specs/sveltekit.md` §4, manifest flag → skip renderer, serve shell).
* No SSG/ISR/adapters, no service worker, no offline story.
* Per-route `Params` types generated (`RouteId` + `Params` in every
  `types/routes/*.d.ts`) — the `$types`-lite.

## Platform / config

* Aliases are `#routes` / `#lib` (hash, current SvelteKit style), not
  `$lib`. `#app/paths` + `#app/environment` virtual stubs generated
  from config. No `$app/forms`, no `$env/static|dynamic/*`.
* `svelte.config.js` `swelte` key holds: `routesDir`, `libDir`,
  `outDir`, `distDir`, `port`, `corsOrigin`, `trailingSlash`, `base`,
  `assets`, `csp`, `csrf`, `methodOverride`, `version`. Env wins at
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

