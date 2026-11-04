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
    targetOs: '',             // '' (host) | 'linux' | 'macos' | 'windows' — `v -o -os` cross (build-only; CLI --target-os wins, $SWELTE_TARGET_OS middle, package.json swelte key fallback)
    targetArch: '',           // '' (host) | 'amd64' | 'arm64' — `v -o -arch` cross (same precedence via --target-arch / $SWELTE_TARGET_ARCH)
    offline: { fallback: 'off' }, // 'off' | 'offline.html' | custom — SW precache + dist file
    chunking: 'layout',       // 'layout' (default) | 'single' | 'route' — client code-splitting ($SWELTE_CHUNKING wins)
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
listed, sibling `entries.ts` (`export function entries()` — sync or
`async` — returning `string[]` | `{ slug }[]`-ish | `{ params }[]`)
expands dynamics only when `entries: 'all'`. `async` (incl. paginated
fetch loops inside the fn) is awaited at generate time; bad shape =
build error with file+line. No prerender implied — just the crawl source.

`swelte build` then boots the built `dist/server` on an ephemeral port
and GETs each crawl URL with browser Accept: 200 HTML →
`dist/<route>/index.html` (root `/` never overwritten —
`dist/index.html` stays the SPA shell). JSON probes and error pages
skipped, never written. Concurrency = `prerender.concurrency`.

Per-page flag (SvelteKit `prerender` page option): `export const prerender
= true | false | 'auto'` in the sibling `.ts` (leaf like `about/+page.ts`
or wrapper like `about/+route.ts`). Leaf wins over the nearest explicit
wrapper, both win over the global `prerender.entries`: `false` excludes
the route even under global cover, `true`/`'auto'` includes it even under
`entries: 'off'` (`'auto'` keeps dynamic dispatch — the manifest already
keeps all routes). Bad values are file+line build errors. `.v`-only
routes follow the global mode (no sibling carrier).

`isr: { '/blog': 60 }` freezes to `SWELTE_ISR=/blog=60` for the crawl env
(`Hand` reads it per request): matching GET HTML 200s stamp
`Cache-Control: public, max-age=0, s-maxage=N` +
`X-Swelte-Revalidate: N` (longest prefix wins). Headers only — no
background revalidation, runtime default unchanged.

Per-route rendering flags (SvelteKit `ssr`/`csr` page options): `export
const ssr = false` opts the route out of SSR (SPA shell); `export const
csr = false` renders SSR HTML only (client mount/hydrate no-op —
`swelte_no_csr()` + `csr: false` in `routes.js`; `ssr-manifest.json`
surfaces `csr` per route). Independent corners, same sibling `.ts`
carrier (leaf wins, else nearest explicit wrapper for `csr`).

Per-route limits (SvelteKit `config` lite, single-binary): `export const
limits = { rate, rateWindowMs, timeoutMs, bodyLimit }` in the sibling
`.ts` (leaf wins, else nearest explicit wrapper; absent = global env
defaults). All fields optional positive ints; bad shape = file+line
build error. Longest-prefix match in `Hand` (dynamic rows go through the
generated `swelte_route_hit()` predicate → `swelte_match_route`, so
`/users/[id]` applies to `/users/42`) overrides `SWELTE_RATE_LIMIT` /
`SWELTE_RATE_WINDOW_MS` / `SWELTE_HANDLER_TIMEOUT_MS` /
`SWELTE_BODY_LIMIT` on that route (`server_gen.v`
`swelte_route_limits()` table; `ssr-manifest.json` surfaces `limits`).
No regions/runtime — one binary, one deploy target.

Per-route serialized headers (SvelteKit
`filterSerializedResponseHeaders` lite): `export const serializedHeaders
= ['x-foo', ...]` (a `: string[]` type annotation is tolerated) in the
sibling `.ts` (leaf wins, else nearest explicit wrapper) names which
load-envelope (`SwelteLoadResult.headers`) headers land on the HTML
navigation. Absent = no filter (all pass — today's behavior). An
explicit list — incl. `[]` (keep nothing) — keeps only those names
(exact match, case-insensitive at runtime; `Set-Cookie` stays on its own
path and `Location` always passes so load-side 3xx redirects keep their
target). Bad shape — incl. a typed declaration that isn't a string
array — = file+line build error. Longest-prefix match in `Hand`
(`server_gen.v` `swelte_serialized_headers()` table; dynamic rows match
via `swelte_route_hit()` → `swelte_match_route`, so `/users/[id]` fires
for `/users/42`; `ssr-manifest.json` surfaces `serializedHeaders`). No
`transformPageChunk` callback — `@[after]` already rewrites the whole
`SwelteResponse` body.

Layout composition (SvelteKit `+page@layout` ergo, no `@` in the
filename): `export const layout = false | true | 'dir'` in the sibling
`.ts` (leaf wins, else nearest explicit wrapper; file+line build error on
bad shape). `false` renders that page outside the whole `+route.svelte`
chain; `'dir'` keeps wrappers at-or-above that ancestor dir (`'admin'`
keeps `admin/+route` + above); `true` pins the full chain back on under a
bare subtree. A wrapper's `layout = false` bares its whole subtree —
set `layout = true` on one leaf to opt it back in. Same URL rules as
plain leaves (`routes.js` cuts the wrapper chain; `ssr-manifest.json`
surfaces `layout` per route). Composition-only: a skipped wrapper's
`@[load]`/`@[before]`/`@[after]` still run — Swelte `+route.v` doubles as
middleware, unlike SvelteKit `+layout` (whose `load` the reset also
skips). Stale `+page@.svelte` files fail the build with the rename +
one-line fix.

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
| `SWELTE_CHUNKING` | `layout` | Client code-splitting (`single` \| `layout` \| `route`). Wins over `swelte.chunking` in `svelte.config.js` and the `swelte()` plugin option (explicit plugin option wins over config; env wins over both). See §Chunking. |

## Chunking (client code-splitting)

The server bundle (`dist/server`) and SSR (`dist/ssr/render.js`) are
unaffected — chunking only cuts the browser JS/CSS. CSS follows JS by
construction (`() => import()` + `cssCodeSplit`, which stays on — never
turn it off or chunk cuts diverge from CSS).

| Mode | Cut | When |
|---|---|---|
| `'layout'` (default) | one lazy chunk per `+route.svelte` subtree | recommended: nav inside a layout is chunk-local, crossing a layout is one `import()` |
| `'single'` | static imports, one JS + one CSS | smallest apps, `prerender`/`offline.html` shells |
| `'route'` | one lazy chunk per leaf | measuring / fine control; pair with prefetch or nav regresses |

Rules:

* Chunk key reads **`+route.svelte` existence**: directory `D` with
  `D/+route.svelte` opens a chunk owning `D/+route.svelte` + every page
  directly in `D` + recursively every page in sub-directories with **no**
  `+route.svelte` on the path. Folders without a wrapper bubble up into
  the parent chunk. There is no per-folder mode: a folder is not a
  runtime boundary (no new `children` snippet, no new `@[load]` level),
  so cutting there only adds waterfall.
* `about.svelte` ⇔ `about/+page.svelte` (same `/about`), but only the
  nested spelling mounts `about/+route.svelte` — so they land in
  different `layout` chunks. One URL = one spelling (`doubleClaimCheck`
  build error otherwise).
* `src/app.css` stays in the entry chunk; `+error` + the matcher table
  stay eager (needed synchronously on 404/no-match); `#lib` and the
  Svelte runtime stay in Vite's default shared chunks.
* `mountSwelteRoute` / `hydrateSwelteRoute` are async (chunk resolve
  before mount/hydrate); the generated entry awaits them. `navigateTo`
  preloads the target chunk in parallel with the data fetch. Components
  resolve through a per-mod cache, so layout + page share one network
  round-trip.
* `serviceWorkerPrecache` already covers `chunk` outputs, so lazy chunks
  work offline; the prerender crawl covers them too.

Per-route override (sibling `.ts`, same regex pass as `export const ssr`):

```ts
// admin/+page.ts (leaf) or admin/+route.ts (whole subtree)
export const chunk = 'eager' | 'lazy' // default: 'inherit' (follow global mode)
```

* leaf `'eager'` = hoist into the parent/layout chunk (landing page);
  `'lazy'` = force its own `import()` even under `single`.
* wrapper `'eager'` = collapse the subtree into the parent chunk;
  `'lazy'` = force a cut at its own dir even when the parent would bubble.
* precedence: leaf > nearest explicit wrapper > global. Bad value =
  build error with file+line (same contract as matchers).
* `+route.ts` **can exist** (sibling of `+route.svelte`): it already
  carries `ssr`/`load` today — chunking is the moment it gets documented.
  The cut itself still reads the `.svelte`; the `.ts` only pins.
  Headless API routes (`.v` only) have no chunk.

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
* **`src/app.v` lifecycle** (`@[startup]`, `@[reroute]`; never
  routed/never importable from browser): `@[startup] () void|!void`
  (zero/one fn, no qualifier, no params) runs once before `veb.run`
  (throw aborts boot); `@[reroute] (host string, path string) string`
  (zero/one fn, no qualifier)
  runs first in `before_request` — before `trailingSlash`
  normalization, CSRF/CORS/static/dispatch
  (`''` = no-op). `@[cron('60s'|'5m'|'1h')]` () void|!void` lives in
  `@swelte/plus/jobs` (add `jobsPlugin` to `swelte({ plugins: [...] })`):
  one-or-more fns, qualifier required; one scheduler thread runs all
  ticks (sleeps to the nearest deadline, idle = zero CPU; missed ticks
  coalesce, no pile-up) in `main` (single-instance best-effort, no
  watchdog, idempotent bodies; fallible `!void` errors are logged
  and the scheduler continues). Without the plugin `@[cron]` is an
  unknown-attr build error.
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
* **Static files** (`public/`): Vite's `publicDir` is untouched, so
  `public/<file>` is served at `/<file>` in dev and copied to
  `dist/<file>` on build (Vite's `emptyOutDir` keeps it after hashed
  `dist/assets/`). `dist/index.html` is the SSR shell and the SPA
  fallback — `serve_static` returns it (200) for any missing path, so
  add real files (favicon, `robots.txt`) rather than relying on that
  fallback for unknown URLs.
* **`HEAD`/`OPTIONS`**: `GET` arms also match `HEAD` (same handler;
  `@[head]` is an alias onto the `GET` arm, never a separate default).
  `OPTIONS` is CORS-preflight-only — no user fn (`@[options]` on a
  handler is a build error), `204` with no `Allow:`-on-405 listing.
* **No-JS forms**: browser `Accept: text/html` POST → `303` + `Location`
  on success, HTML-escaped error page on failure. Fetch
  (`Accept: application/json`) keeps JSON. Same handler.

