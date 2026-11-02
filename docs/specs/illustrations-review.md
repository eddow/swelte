# Illustrations — remaining work

Source: `docs/specs/illustrations.md`. Closed and proved in
`docs/example.md`: 1, 2, 5, 6, 11, 12. What follows is only what is
still unproved, plus the constraints found while implementing the
closed items.

## Gotchas (apply to everything below)

* A svelte-only page still needs a dispatch arm: a lone `@[load]` `.v`
  emits a **405-only** dispatch arm (`emitRouteFile` strips loads, so
  `verbs=[]` → `swelte_method_not_allowed()` on every verb — see
  `dispatchBody` `methodGate`, `vite.ts:2526`). Bare GET is 405 JSON and
  an HTML navigation on a 405 maps to the error page, not the leaf —
  so the page never serves HTML 200. Ship a trivial `@[get]` probe arm
  (see `router/tags/+page.v`) so the URL serves HTML 200 + SSR.
* Never write a full `@[verb]` attribute on its own comment line
  directly above a real attribute in a `.v` file — FIXED 2026-11-02:
  `parseVFile` blanks comment lines that themselves contain an
  attribute before the stacked-attr merge, so `// @[sse]` over a real
  `@[get]` parses as get-only (real multi-line stacks still fan out;
  pinned in `bunch1.test.ts`).
* Mixed emit+list `@[sse]` in one file is unservable
  (`swelte_sse_is_emit()` returns one per-file bool,
  `vite.ts:2415-2416`). One mode per file.
* Avoid `@swelte/core` even in `.svelte` **comments** — FIXED
  2026-11-02: `stubSdkImports` (`engine/ssr-qjs/src/ssr.ts`) now
  skips matches whose line-start holds a `//` outside string
  literals, so commented-out imports survive untouched (pinned in
  `bunch1.test.ts`).
* Baseline: `tsc --noEmit` on `examples/something` — FIXED 2026-11-02:
  was failing on generated `.swelte/entry-main.ts` (TS2554, 2-vs-3
  args); the entry now passes explicit `undefined` and generate()
  emits an adjacent `entry-main.d.ts` declaring `errorProps?`
  optional, so user `tsc` is clean (verified after rebuild; pinned in
  `bunch1.test.ts`).
* `docs/specs/illustrations.md` engine line numbers are stale
  (sdk.ts drifted ~+40-90). Current anchors: `loadPage` 464,
  `depends`/`invalidate` 610-623, `isFail` 675, `deserialize` 698.
  Refresh with `grep -n` before citing.
* When promoting to `docs/example.md`, tag lines with `(item N)`.

## 3. `loadPage()` error branch

* Only the trigger is missing — `admin/+page.svelte` already renders
  the branch (via `isPageError`/`isPageData`), and the SDK side is
  pinned (`sdk-errors.test.ts`: RPC → `{error}`, plain throw → 500,
  `loadPage` 464-471). Cheapest: a force-fail button on `/admin`
  (no `.v` change — `loadPage` wraps any stub, so calling a guarded
  fn without `sess` already yields 400 `missing session` via the
  `+[route]` `@[before]` arm). Alternative: a `/router/throw` leaf
  with an always-throwing `@[get]` + `loadPage` on mount; the throw
  arm itself IS the dispatch arm, so no extra probe arm is needed
  (the probe-arm gotcha applies to svelte-only leaves with no verb
  at all — `/router/throw` has one).
  Either way assert the client `ErrorPage` render without a full-page
  SSR `+error` render (same component, client branch).

## 4. `isFail()` + `deserialize()`

* `@[post('save')]` 422 fail-lite arm returning
  `{ ok: false, fieldErrors: {...} }` + a `?save` form with
  `if (isFail(e, 422))` inline branch, plus one envelope assert.
  Keep the two asserts independent — this does not depend on item 15.
  Verified 2026-11-02 against `dist/sdk.js`: `isFail` matches on
  `ok === false` + object `fieldErrors` only (`ok:true` → false,
  missing `fieldErrors` → false; bare status defaults to any 4xx).
  For the second assert do NOT call `deserialize` on the raw verb JSON —
  it rejects non-envelopes (`unknown type undefined`). Assert either a
  real SvelteKit `{type:'failure',…}` envelope through `deserialize`,
  or the raw verb body through `__swelteActionResult`
  (deserialize-first with raw-JSON fallback — this is what
  `use:enhance` calls), so the server needs no envelope.

## 7. Custom matchers + `[id=matcher]`

* `src/matchers.v` `slug` in the portable subset only
  (`for c in s.bytes()`, byte compares, early returns; no
  `time`/`os`/`net` imports — enforced subset: no fn calls except
  `charCodeAt`, `transpileMatcherBody`, `vite.ts:960-1029`; import
  blocklist also covers `db`/`v`/`x`/`wasm`, `vite.ts:1052`) +
  `users/[id=integer].v` + `posts/[slug=slug].v`. Assert 200 vs 404 on
  V dispatch and client `matchSegs`, `Params: number` for the integer
  leaf. The two leaves do NOT collide: the dynamic-shape guard
  normalizes `[id=integer]` and `[slug=slug]` to the same `[]` shape
  and would reject coexisting same-dir dynamics — ship them in
  different dirs (`users/` vs `posts/`, which never collide) and keep
  `users/[id].v` during transition (renaming changes the existing
  `/users/abc` 404 reason); update the `example.md` line together.

## 8. Route groups `(group)` + optional `[[slug]]`

* `(mkt)/+page.svelte` strip check + `docs/[[slug]]` pair asserting
  zero-or-one (`/docs` + `/docs/x` → 200, `/docs/x/y` → 404).
  A group-only `(mkt)/+page` maps to `/` by rule (`vite.ts:342-344`:
  stripped empty + non-empty dir → `/`), so it claims the root URL —
  never ship it alongside the existing `/` leaf (unconditional
  folder-root double-claim build error, `doubleClaimCheck`). Use a
  distinct path (e.g. `(mkt)/about`) or prove strip-only in a
  throwaway pass.

## 9. `src/app.v` lifecycle

* `src/app.v` with `@[startup]` boot stamp + `@[reroute]` rewriting
  `/old` → `/router`, served without redirect. `@[startup]` is
  `() void` (fallible `!void` accepted, params never — `loadServerHooks`
  rejects `void|!void` mismatch); `@[reroute]` is exactly
  `(host string, path string) string` with no qualifier, one fn each
  (`generate-errors.test.ts` pins both). Throw in startup aborts boot;
  reroute runs after `trailingSlash` normalization, before
  CORS/static/dispatch (`''` = no-op). Missing file → harness
  byte-identical to the skeleton (`renderHarness`, `gen/config.ts`).
  Keep `@[cron]`/`@[queue]` out (→ `specs/moar.md`). Touch the
  `example.md` Layout block when this lands (it currently says
  `src/app.v` is absent).

## 10. Request hardening knobs

* One `/router/limits` doc block with curl asserts, promoted line by
  line: `?slow&ms=12000` → 500 + server alive (`SWELTE_HANDLER_TIMEOUT_MS`
  default 10s; `slow_probe` arm already ships as `?slow&ms=` on
  `/api/greet`); 121 rapid hits → 429 (defaults `SWELTE_RATE_LIMIT=120` /
  `SWELTE_RATE_WINDOW_MS=60000` — `SWELTE_RATE_LIMIT=121` would NOT trip
  on hit 121: the check is `count > limit` after increment, so set the
  env BELOW the hit count or document 121-vs-default); cross-origin POST
  with `SWELTE_CSRF_CHECK_ORIGIN=1` → 403 (mutating verbs only when
  both Origin and Host are present and mismatch); OPTIONS with origin →
  204 **always, CORS or not** (preflight branch runs before the CORS
  gate; without a matching `SWELTE_CORS_ORIGIN` the 204 just carries no
  `Access-Control-*` headers); `POST ?_method=DELETE` → verb dispatch
  **only with `SWELTE_METHOD_OVERRIDE=1`** (default OFF); trailing-slash
  301s **only under `SWELTE_TRAILING_SLASH=always|never`** (default
  `ignore` = no redirect); `X-Swelte-Version` header present **only when
  `SWELTE_VERSION` is set** (package.json bake or explicit env — unset
  means no header at all). For the rate probe, allow a lowered
  `SWELTE_RATE_LIMIT` and record the env used (121 hits is slow/flaky
  in CI — prefer a small limit + few hits).

## 13. Backend-only `#lib/` import guard (negative proof)

* One-line proof only: scratch-import `src/lib/backend/secrets.v`
  from a browser file. The exact failure depends on the importer:
  a `.svelte` file never reaches the guard — `.svelte` has no `.v`
  import channel (browser imports resolve via `#lib/*.v` stubs, and
  `#lib/backend/*` from a `.svelte`/TS path is just unresolvable,
  not a `swelte check` error). The loud guard fires at **build time**
  on a `.v` importer: `#lib/*.v` (non-backend) importing backend →
  build error `only #routes/*.v may import #lib/backend (V-to-V include
  at codegen time)` (`vite.ts:3354-3356`); `#routes/*.v` importing
  backend is the *allowed* V-to-V include; browser code importing the
  built stub throws `[swelte] … is backend-only (#lib/backend) and
  cannot be imported in browser code` (`vite.ts:4242-4245`). So: prove
  with a scratch **`.v`** import (`#lib/*.v` → backend) and record the
  build error text in `docs/example.md`; delete the scratch import.
  `swelte check` only warns `backend-ts` for stray TS/JS/Svelte files
  *under* `backend/`, not for imports — never wire the scratch import
  into a shipping route.

## 14. Opt-in service worker (throwaway pass)

* Keep default OFF. Prove in a throwaway pass, then revert:
  `SWELTE_SW=1 swelte build` → `dist/sw.js` exists with `SW_PRECACHE`
  shell+hashes (`/`, hashed `assets/*.js`, hashed `assets/*.wasm` —
  `serviceWorkerPrecache` seeds `/` + every `assets/*` asset/chunk,
  `vite.ts:4657-4670`, emitted at `vite.ts:4412-4426`); `dist/index.html`
  carries the register snippet (auto mode; `manual` emits the file but
  skips the snippet); `curl /sw.js` → `200 application/javascript`
  (static-first exact-file serve wins over Accept routing);
  default rebuild drops both. Record the four asserts in
  `docs/example.md`.

## 15. SvelteKit remainder (split: 15a–f, close independently)

* 15a `use:enhance`: `/router/enhance` leaf, plain `<form method=post
  use:enhance>` asserting `page.form` publish + reset without reload.
* 15b prerender: `prerender.entries: 'static'` throwaway build,
  `dist/about/index.html` exists while `dist/index.html` stays the
  shell (root `/` never overwritten, `config.md`).
* 15c ISR: `isr: { '/about': 60 }`, `Cache-Control: public, max-age=0,
  s-maxage=60` + `X-Swelte-Revalidate: 60` on GET HTML 200s
  (headers-only, longest prefix wins — no background revalidation).
* 15d targets: `--target node|edge|static` shim file each (`node` →
  `dist/Dockerfile.swelte`, `edge` → `dist/_headers`, `static` →
  `dist/.swelte-static` signal; default `auto` = no extra files).
* 15e offline: `offline.fallback` → `dist/offline.html` (custom or
  `'offline.html'`, never overwrites, best-effort from first crawled
  page) precached only when SW is on.
* 15f export: `swelte export` → `snapshot/snapshot.json`
  (`{version: 1, target, pages[], at}`) + `snapshot/entries.json` +
  `snapshot/pages/<rel>.html` + contract copy — `pages[]` lists
  dist-relative `.html` paths (`commands/export.ts:49-55`).
* Precedent: item 14's throwaway pattern — do not ship these knobs in
  `svelte.config.js`, prove then revert. Promote each line to
  `docs/example.md` as asserted.

