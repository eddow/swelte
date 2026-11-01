# Coming from SvelteKit

Swelte keeps Svelte 5 on the frontend and replaces the Node backend with V
(native binary). File names look familiar on purpose — but the runtimes,
data flow, and a few conventions differ. This page lists every difference
that bites during migration. Built behavior only; open work is marked
`(planned → specs/sveltekit.md §N / specs/moar.md)`.

## Files

| SvelteKit | Swelte | Notes |
|---|---|---|
| `+page.svelte` | `+page.svelte` | Same. Component per URL leaf. |
| `+page.ts` / `+page.server.ts` | `+page.v` (`@[load]`) | Server-only `load`, HTML-navigation initial paint. No universal `load`. `parent T` param replaces `parent()`. |
| `+layout.svelte` | `+route.svelte` | Wrapper per subtree (nav + chrome), but composition is explicit/manual — no nested `<slot/>` inheritance magic; the router nests via `children` snippets automatically. |
| `+layout.server.ts` | `+route.v` (`@[load]`) | Same cascade position. Level 0 takes `(req)`; deeper takes `(req, parent T)` — typed parent value instead of `await parent()`. Mismatch is a build error. |
| `+server.ts` | verbs in the leaf `.v` | No standalone `Response` file. `@[get]`/`@[post]`/`@[put]`/`@[patch]`/`@[delete]` on the route file; one default per verb, `?q` qualifiers for many-per-file. Returns `string`/struct, not `Response`. |
| `+error.svelte` (per-dir) | single global `+error.svelte` | By design — no per-directory inheritance. Props `{ status?, message? }`, renders server-side and client-side (via `loadPage`). |
| `params/*.ts` matchers | `src/matchers.v` `@[matcher]` | Central file, V-only + codegen'd JS mirror (planned §2.10). `[id=integer]`; v1 `integer` only. |
| `hooks.server.ts` | `+route.v` `@[before]`/`@[after]` + lifecycle file | Subtree middleware stays in `+route.v`; root `+route.v` is already the global head (done §2.14). `init`/cron/queue/reroute go in the server-lifecycle file (planned → `specs/moar.md`). No `handle/handleFetch/handleError`; `transformPageChunk` = `@[after]` string rewrite. `init` = `@[startup]`. |
| `src/lib/server/*` | `src/lib/**/backend/*.v` or `*_backend.v` | Physical: backend-only files are a build error from browser/`#lib/` WASM imports. Same V compiles native + WASM for non-backend `#lib/`. |
| `+page.v` naming | `+page.v` / legacy `index.v` | `foo/+page.v` (or `foo/index.v`) claims `/foo`. `foo.v` + `foo/+page.v` together is a build error (one file per URL). |

## Routing

* **The route IS the file path:** `src/routes/api/greet.v` → `/api/greet`.
  Only wrappers use `+` (`+route.v`/`+route.svelte`, `+page.v`, `+error.svelte`).
* **Route groups `(group)`** — disk-only folders, stripped from URL.
  Done. No layout-reset magic beyond the strip; wrapping stays explicit.
* **Optional `[[slug]]`** — last-segment only, zero-or-one. Done.
* **Matchers `[id=integer]`** — done (§2.10, builtins only: `integer`
  → digits, enforced server-side in `swelte_match_route` + client
  `matchSegs`/`__swelteUrl`; `Params` narrows to `number`). Custom
  matchers via central `src/matchers.v` still planned.
* **`trailingSlash`** in `svelte.config.js` (`swelte` key) + env wins.
  Server 301s + stub URL normalization. Done, default `ignore`.
* **Dynamic wrapper dirs unsupported**: no brackets in `+route.v` paths.
* **`.svelte` and `.v` match independently** (HTML vs JSON never conflict).
* **No `reroute` yet** — planned `@[reroute]` in the lifecycle file.

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
  → `@[post('delete')]`. Done.
* No-JS: browser `Accept: text/html` POST → `303` + `Location` on
  success, rendered HTML error on failure. Fetch (`Accept:
  application/json`) keeps JSON. Same handler, content-negotiated.
* No `fail(422, {fieldErrors})` helper — convention is
  `{ ok: false, fieldErrors: map[string]string }` thrown as `!T` +
  `sdk.ts isFail(e, status?)` narrowing. Done (§2.11 docs + `isFail()`).
* No `use:enhance`/`applyAction` cycle — `deserialize` port is done
  (§2.12, pure TS in `sdk.ts`, no client router needed).

## Rendering

* SSR is runtime-only: embedded QuickJS (`SWELTE_SSR=1`) or sidecar
  (`SWELTE_SSR_URL`), 50ms/16MB budgets, fallback to SPA shell.
  Never emits prerendered `.html`. Default is SPA/static + JSON.
* No per-route `ssr`/`csr`/`prerender` flags yet — `ssr=false`-lite
  planned (§2.13, manifest flag → skip renderer, serve shell).
* No SSG/ISR/adapters, no service worker, no offline story.
* Per-route `Params` types generated (`RouteId` + `Params` in every
  `types/routes/*.d.ts`) — the `$types`-lite. Done.

## Platform / config

* Aliases are `#routes` / `#lib` (hash, current SvelteKit style), not
  `$lib`. `#app/paths` + `#app/environment` virtual stubs generated
  from config (done). No `$app/forms`, no `$env/static|dynamic/*`.
* `svelte.config.js` `swelte` key holds: `routesDir`, `libDir`,
  `outDir`, `distDir`, `port`, `corsOrigin`, `trailingSlash`, `base`,
  `assets`, `csp`, `csrf`, `methodOverride`, `version`. Env wins at
  runtime (`SWELTE_*`), defaults when unset/invalid.
* `CSP` injected as meta, `CSRF` origin-check, `_method` override,
  `X-Swelte-Version` header — all done (§1.6/1.9).
* `HEAD` auto-handled on `GET` arms; `OPTIONS` is CORS-preflight-only
  (no `Allow:`-on-405 listing). Done (§1.8 shape-adjusted).
* Errors: `SwelteRpcError` (`status`, `body`, `base`, `fn`) replaces
  thrown `error()`/`json()` helpers; `loadPage()` maps load-time
  failures to `+error` props. `locals map[string]string` threaded
  through dispatch + `swelte_cookie_get/set/delete` helpers. Done (§1.7).
* Single artifact: `dist/server` + `dist/`. No Node at runtime.

