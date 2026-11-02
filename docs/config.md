# Config + env: `svelte.config.js` and `SWELTE_*`

Single rule everywhere: **env wins when set; config is the fallback;
unset/invalid/zero/negative means built-in default** (never "disable").
`dev`/`build`/`preview` forward config values into env for the V binary
when the env var is not already set.

## `svelte.config.js` (`swelte` key)

```js
import { defineConfig } from '@swelte/core/config';
export default defineConfig({
  preprocess: vitePreprocess(), // required by the Svelte VS Code extension
  swelte: {
    name: 'myapp',          // default '' — used by version stamp
    routesDir: 'src/routes', // default
    libDir: 'src/lib',       // default
    outDir: '.swelte',       // default — generated code
    distDir: 'dist',         // default — static output
    port: 8131,              // V backend ($PORT wins)
    corsOrigin: '',          // '' = no CORS headers ($SWELTE_CORS_ORIGIN wins)
    trailingSlash: 'ignore', // 'always' | 'never' | 'ignore' (default)
    base: '',                // URL base (#app/paths)
    assets: '',              // assets prefix (defaults to base)
    csp: '',                 // '' = no meta tag injected
    csrf: 'ignore',          // 'ignore' | 'enforce'
    methodOverride: false,   // honor `?_method=` on POST
    version: '',             // '' = package.json version
    serviceWorker: { enabled: false, register: 'auto' }, // opt-in SW → additive dist/sw.js
    prerender: { entries: 'off', concurrency: 4 }, // 'off' | 'static' | 'all' → entries.json + dist/*.html
    isr: {},                  // { '/blog': 60 } → Cache-Control s-maxage + X-Swelte-Revalidate
    target: 'auto',           // 'auto' | 'static' | 'node' | 'edge' — packaging only
    offline: { fallback: 'off' }, // 'off' | 'offline.html' | custom — SW precache + dist file
  },
});
```

`defineConfig` keeps `swelte` non-enumerable: invisible to `svelte()`
(no "invalid plugin options" warning) but readable by `loadConfig`.

## Service worker (opt-in offline shell)

Disabled by default — zero SW bytes, zero registration, SPA-first
unchanged. When `swelte.serviceWorker.enabled` is `true` (or
`SWELTE_SW=1` in the env, which wins):

* `swelte build` emits additive `dist/sw.js` (hand-rolled, no workbox
  dep): precaches `/` + hashed `assets/*.js` + `assets/*.wasm`, cache
  version = `version` stamp, old caches purged on activate.
* `transformIndexHtml` injects a same-origin registration snippet
  (`register: 'auto'`, the default); `register: 'manual'` emits the
  file but skips the snippet so the app registers itself.
* Runtime behavior: GET navigations + immutable assets are
  cache-first with SPA-shell offline fallback; `Accept:
  application/json` / `text/event-stream` / POST / `/api/*` are
  network-only (offline → the caller sees the failure, never stale
  JSON). `#lib/` WASM rides the same immutable-asset cache.
* `Hand` serves exact `dist/` files (incl. `sw.js`) regardless of
  Accept — the SPA-first proxy rule is about routes, real files win.

## Prerender / SSG + ISR (additive `dist/*.html` only)

Default is runtime-only (no prerendered `.html`); `prerender.entries`
enables the crawl. `generate()` writes `.swelte/entries.json`
(`{ version, mode, routes, dynamics, expanded }`): static routes always
listed, sibling `entries.ts` (`export function entries()` returning
`string[]` | `{ slug }[]`-ish | `{ params }[]`) expands dynamics only
when `entries: 'all'`. Bad shape = build error with file+line. No
prerender implied — just the crawl source.

`swelte build` then boots the built `dist/server` on an ephemeral port
and GETs each crawl URL with browser Accept: 200 HTML →
`dist/<route>/index.html` (root `/` never overwritten —
`dist/index.html` stays the SPA shell). JSON probes and error pages
skipped, never written. Concurrency = `prerender.concurrency`.

`isr: { '/blog': 60 }` freezes to `SWELTE_ISR=/blog=60` for the crawl env
(`Hand` reads it per request): matching GET HTML 200s stamp
`Cache-Control: public, max-age=0, s-maxage=N` +
`X-Swelte-Revalidate: N` (longest prefix wins). Headers only — no
background revalidation, runtime default unchanged.

## Deploy targets (packaging only, no Node runtime)

`--target` flag wins, else `swelte.target`. `auto` (default) = no extra
files. `static` → `dist/.swelte-static` (pure `dist/` signal);
`node` → `dist/Dockerfile.swelte` (runs `./dist/server`, no Node);
`edge` → `dist/_headers` (`/* → X-Swelte-Target: edge` + per-`isr`
`Cache-Control` lines). Single artifact `dist/server` + `dist/` holds
in every mode.

## Offline fallback page (service-worker remainder)

`offline.fallback: 'offline.html'` (or a custom path; default `'off'`)
writes `dist/<fallback>` from the first crawled page (best-effort, never
overwrites) and — when the SW is enabled — precaches it. Shell +
immutable assets stay cached, API/SSE network-only (unchanged).

## Env vars (what the V `Hand` actually reads)

| Var | Default | Effect |
|---|---|---|
| `PORT` | `8131` | V backend listen port. |
| `SWELTE_DIST` | unset (dev) / `dist` (preview) | Static dir: `serve_static` + SSR shell source. Unset = API-only. |
| `SWELTE_CORS_ORIGIN` | unset | `*` or exact origin. Set → `Access-Control-Allow-Origin` (+ credentials) on all responses; preflight `OPTIONS` → `204` with `Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`. Unset = no CORS headers; without a matching CORS origin, mutating requests still require same-origin (`403` otherwise). |
| `SWELTE_TRAILING_SLASH` | `ignore` | `always`: `301` non-`/` paths to trailing-`/` form. `never`: `301` away. Stub `__swelteUrl` normalizes the same way. |
| `SWELTE_CSP` | unset | Value injected as `<meta http-equiv="Content-Security-Policy">` in `transformIndexHtml` (static + SSR shells). Skipped when unset. |
| `SWELTE_CSRF_CHECK_ORIGIN` | unset (`ignore`) | `1` = reject cross-origin `POST/PUT/PATCH/DELETE` whose `Origin` doesn't contain `Host` (`403`). `GET/HEAD` never checked. Dev sets same-origin `SWELTE_CORS_ORIGIN` so the Vite proxy passes. |
| `SWELTE_METHOD_OVERRIDE` | unset (off) | `1` = `POST ?_method=DELETE` (or `PUT`/`PATCH`) re-dispatches as that verb. Body stays form-encoded. |
| `SWELTE_VERSION` | package.json `version` | Emitted as `X-Swelte-Version` response header when set. Also baked into `.swelte/version.js` (`version` + `buildTime` ISO) for `#app/environment`. |
| `SWELTE_BODY_LIMIT` | `10485760` (10MB) | Max `req.data` bytes before routing (multipart included). Over → `413`. |
| `SWELTE_RATE_LIMIT` / `SWELTE_RATE_WINDOW_MS` | `120` / `60000` | Fixed-window per-IP limit (in-memory, single-instance; stale buckets evicted opportunistically). Over → `429`. |
| `SWELTE_HANDLER_TIMEOUT_MS` | `10000` | Handler budget via `spawn` + `select`. Over → `500` (server stays up; timed-out thread still runs to completion in the background). |
| `SWELTE_SSE_MAX_EVENTS` | `10000` | Caps runaway SSE streams. |
| `SWELTE_SSR` / `SWELTE_SSR_URL` | unset | `1` = embedded QuickJS; URL = sidecar proxy. Unset = SPA/static + JSON always. `preview` auto-sets `SWELTE_SSR=1` when the QJS bridge artifact exists. See `ssr.md`. |
| `SWELTE_ISR` | unset | `prefix=seconds,...` (frozen by `swelte build` from `swelte.isr`). Longest prefix wins; matching GET HTML 200s stamp `Cache-Control: public, max-age=0, s-maxage=N` + `X-Swelte-Revalidate`. Headers only. |
| `SWELTE_SW` | unset (off) | `1` = force the opt-in service worker emit (`dist/sw.js` + registration snippet) without touching `svelte.config.js`. See `config.md` §Service worker. |
| `SWELTE_V_BACKEND_URL` | unset | Dev RPC proxy target for Vite (injected by `swelte dev`). Unset = no proxy. |
| `SWELTE_CLIENT` | unset | `1` = `check` typechecks the client stubs too (default: server-only). |

## Request behavior driven by config/env

* **Routing knobs**: route groups `(group)` stripped from URL, optional
  `[[slug]]` last-segment only, dynamics `[id]`/`[id=matcher]`/`[...rest]`
  (catch-all last, static beats dynamic; `[id=integer]` = digits-only
  builtin, enforced both sides, `Params` narrows to `number`).
* **Custom matchers** (`src/matchers.v`, never routed/never WASM):
  `@[matcher] (s string) bool`, non-fallible, one fn per name, portable
  subset only (`for c in s.bytes()`, `s.len`, byte compares, early
  returns; no `time`/`os`/`net` imports). Bodies inline into
  `swelte_matcher_check` + transpile to both JS mirrors
  (`__swelteUrl` guard + `matchSegs`). Custom matchers project
  `string` (only `integer` narrows to `number`). Unknown name/bad
  shape = build error with file+line.
* **`src/server.v` lifecycle** (`@[startup]`, `@[reroute]`; never
  routed/never importable from browser): `@[startup] () void` runs once
  before `veb.run` (throw aborts boot); `@[reroute] (host, path) string`
  runs after `trailingSlash` normalization, before CORS/static/dispatch
  (`''` = no-op). `@[cron]`/`@[queue]` are open (→ `specs/moar.md`).
* **`+route.svelte` nesting** (Svelte 5 `children` Snippet, not slots):
  every wrapper must declare `children` via `$props()` + `{@render
  children?.()}` (missing = SSR build error). SPA mount nests
  automatically; SSR `renderRoute` composes root→leaf server-side
  (`wrappersByRoute` in `ssr-manifest.json`); client `hydrateSwelteRoute`
  hydrates the whole chain in place (one top-level `hydrate()` of the
  outermost wrapper, each level's `children` snippet invokes the inner
  component on the snippet anchor, so SSR DOM is adopted, not remounted;
  mismatch falls back to mount).
* **Per-route types**: every `types/routes/*.d.ts` starts with
  `RouteId` + `Params` (the `$types`-lite). Client `__swelteUrl(args)`
  interpolates dynamics and strips them from the payload; missing param
  throws `swelte: missing route param`.
* **`#app/paths` / `#app/environment`**: generated `.swelte/paths.js`
  (`base`, `assets`) + `.swelte/environment.js`
  (`browser`, `dev`, `building`, `version`) from config. No V side.
* **`SwelteRequest.locals` + cookie helpers**: `locals map[string]string`
  threaded dispatch → verbs/`load`; `swelte_cookie_get/set/set_full/delete` (+`swelte_text/json/status/bytes/redirect` constructors)
  emitted. `before_request` passes empty locals (middleware fills it).
* **`HEAD`/`OPTIONS`**: `GET` arms also match `HEAD` (same handler).
  `OPTIONS` is CORS-preflight-only (`204`, no `Allow:`-on-405 listing).
* **No-JS forms**: browser `Accept: text/html` POST → `303` + `Location`
  on success, HTML-escaped error page on failure. Fetch
  (`Accept: application/json`) keeps JSON. Same handler.

