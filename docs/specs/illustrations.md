# Illustrations — built but not yet demoed in `examples/something`

This file tracks ONLY features `core` + `ssr-qjs` already implement
(proven by unit/build/contract tests) that `examples/something/` does
not yet exercise. Delete an item when a demo route/file proves it;
add the `docs/example.md` "Proved" line at the same time.

How to read each item: **what** (one line), **where it lives**
(engine file/test), **what the demo is missing**, **smallest demo
that would prove it**.

## 1. `depends()` / `invalidate()` / `invalidateAll()`

* What: tag registry in `sdk.ts` — `depends(...tags)` inside a load
  registers tags; `invalidate(...tags)` clears matching load keys,
  `invalidateAll()` clears all (client-side).
* Engine: `engine/core/src/sdk.ts:555-572`, test
  `engine/core/src/codegen-shape.test.ts:469`.
* Gap: no demo file calls any of the three. `/router` proves the router
  but never tags a load.
* Demo: a `/router/tags` leaf with two buttons — `depends('user')`
  inside a `loadPage` wrapper, then `invalidate('user')` re-runs only
  that key while a second `depends('other')` load stays cached;
  show `invalidateAll()` clearing both. Assert via the `page.data`
  refresh (no full `goto`).

## 2. `updated` store

* What: `sdk.ts` version flag (`page`/`navigating`/`updated` triple).
  Currently a stub — no version check feeds it
  (`engine/core/src/sdk.ts:496`).
* Engine: `sdk.ts:496`, re-exported via `.swelte/app/stores.js` +
  `.swelte/app/state.js`.
* Gap: `/router` renders `$page` and `$navigating` but never `$updated`.
* Demo: blocked on §4 snapshot export (the feed). Until then, document
  as stub-lit: render `{$updated}` next to the other two stores and
  note it never flips. Remove this item when snapshot export lands
  and the demo asserts a flip.

## 3. `loadPage()` error branch → `+error` props (client)

* What: `loadPage(fn)` maps `SwelteRpcError` → `{ error: { status,
  message } }` for the global `+error` view
  (`engine/core/src/sdk.ts:410-418`).
* Engine: `sdk.ts:410`, used once in `admin/+page.svelte`.
* Gap: the error branch is never triggered in the demo — `/boom`
  proves the SSR `!T` gate, `admin` only calls `loadPage` on click
  with a valid session path. No demo renders the client `error`
  branch (`result.error` → `<ErrorPage>`).
* Demo: a `/router/throw` leaf whose `@[get]` always
  `return error('client-throw')`; the `.svelte` calls it through
  `loadPage` on mount and renders `<ErrorPage status message>`.
  Assert the error view appears without a full-page SSR `+error`
  render (client branch, same component).

## 4. `isFail()` fail-lite + `deserialize()` action envelope

* What: `isFail(e, status?)` narrows `!T` fail bodies
  (`{ ok: false, fieldErrors }`); `deserialize(res)` parses the
  `{"type":"success"|"failure"|"error"|"redirect",…}` envelope
  (`sdk.ts:620-663`, tests `sdk-errors.test.ts:99-127`).
* Engine: `sdk.ts:608-663`; docs `docs/forms.md:30-48`.
* Gap: zero demo usage — the home page catches `SwelteRpcError`
  generically (`showError`), never narrows with `isFail`, and no
  route produces a `fail`-shaped body or a redirect envelope for
  `deserialize`.
* Demo: add a `@[post('save')]` arm returning a fail body on empty
  payload (`{ ok: false, fieldErrors: { name: 'required' } }` with
  422), a form posting to `?save`, and an inline
  `if (isFail(e, 422)) showInline(e.body.fieldErrors)` branch;
  plus one `deserialize(await fetch(...))` call asserting the
  `success` envelope shape. (`use:enhance` itself is open — §2.)

## 5. SSE list mode (`[]string` return)

* What: `@[sse]` has two shapes — list mode returns `[]string`
  (harness streams each per-event), emit mode takes trailing
  `emit fn (string) bool` (`docs/rpc.md:63,77`).
* Engine: generator `engine/core/src/vite.ts` (`swelte_sse_*`),
  client stub `AsyncGenerator<string>` either way.
* Gap: only emit mode is demoed (`tick_stream` in `api/greet.v`
  + Stream button). No route returns `[]string`.
* Demo: `@[sse('ticks')] pub fn tick_list(...) []string { return ['a',
  'b', 'c'] }` on `api/greet.v` + a List button next to Stream;
  assert identical `for await` consumption and pacing.

## 6. `@[put]` / `@[patch]` verbs

* What: full verb set (`get/post/put/patch/delete`) with one default
  per verb + unique qualifiers per file.
* Engine: `vite.ts` verb dispatch + `swelte_method_not_allowed`
  (405 arm); tests in `codegen-shape.test.ts`.
* Gap: demo has `@[get]`/`@[post]`/`@[delete]` only. No `@[put]` /
  `@[patch]` arm exists anywhere.
* Demo: `@[put] pub fn rename(...)` + `@[patch] pub fn touch(...)`
  on `api/greet.v` (or the `/router` leaf `.v`) with two buttons;
  assert JSON round-trip. Also proves the 405 arm stays quiet.

## 7. Custom matchers (`src/matchers.v` + `[id=matcher]`)

* What: central `src/matchers.v` `@[matcher] (s string) bool` fns in
  the portable subset inline into `swelte_matcher_check` + both JS
  mirrors (`__swelteUrl` guard + `matchSegs`); `[id=integer]`
  builtin, `Params` narrows to `number` (`docs/config.md:58-69`).
* Engine: `vite.ts:531-534,861-899`, `routeFor` + stub URL gen.
* Gap: no `src/matchers.v` in the demo, no `[id=...]` segment —
  `/users/[id]` is unconstrained, `Params` narrowing unproved.
* Demo: `src/matchers.v` with one `@[matcher] pub fn slug(s string)
  bool` (lowercase-alnum check, portable subset) + a
  `users/[id=integer].v` leaf echoing `req.params['id']` and a
  `posts/[slug=slug].v` leaf; assert digits-only 200 vs `/users/abc`
  404 on both sides (V dispatch + client `matchSegs`), and `Params`
  typing `number` for the integer leaf.

## 8. Route groups `(group)` + optional `[[slug]]`

* What: `(group)` disk folders stripped from URL; `[[slug]]`
  last-segment zero-or-one (`docs/config.md:58-60`,
  `coming-from-sveltekit.md:27-29`).
* Engine: `stripRouteGroups` (`vite.ts`), rank/sort + `matchSegs`
  optional branch in generated `routes.js`.
* Gap: flat demo tree — no `(x)` dir, no `[[...]]` file.
* Demo: `(mkt)/+page.svelte` served at `/` alongside the existing
  root (proves strip, still one-file-per-URL) + a
  `docs/[[slug]].v`/`.svelte` pair asserting zero-or-one
  (`/docs` and `/docs/x` both 200, `/docs/x/y` 404).

## 9. `src/server.v` lifecycle (`@[startup]` / `@[reroute]`)

* What: `@[startup] () void` runs once before `veb.run` (throw
  aborts boot); `@[reroute] (host, path) string` runs after
  `trailingSlash` normalization, before CORS/static/dispatch
  (`docs/config.md:70-74`).
* Engine: harness template `engine/core/templates/harness/server.v`.
* Gap: demo has no `src/server.v` at all (only the generated
  `.swelte/server.v` harness).
* Demo: `src/server.v` with `@[startup]` stamping a boot line and
  `@[reroute]` rewriting `/old` → `/router`; assert the rewrite
  serves `/router` content at `/old` with no redirect. (Stays
  clear of open `@[cron]`/`@[queue]` → `specs/moar.md`.)

## 10. Request hardening knobs (env-gated, all built)

* What: `SWELTE_BODY_LIMIT` (413), `SWELTE_RATE_LIMIT` /
  `SWELTE_RATE_WINDOW_MS` (429), `SWELTE_HANDLER_TIMEOUT_MS`
  (500, server stays up), `SWELTE_CSRF_CHECK_ORIGIN` (403),
  `SWELTE_CORS_ORIGIN` (preflight 204), `SWELTE_METHOD_OVERRIDE`
  (`?_method=`), trailing-slash 301s, `X-Swelte-Version`
  (`docs/config.md`, `docs/errors.md`).
* Engine: harness `server.v` guards + `Hand` dispatch.
* Gap: partially demoed only — uploads prove the 10MB cap and
  over-cap 413; `?slow` exists for the timeout watchdog but no doc
  line asserts it; rate-limit/CSRF/CORS/override/trailing-slash/
  version-header have no demo route or doc claim at all.
* Demo: one `/router/limits` doc block (no new UI needed) asserting
  via curl: `?slow&ms=12000` → 500 + server alive; 121 rapid hits
  → 429; cross-origin POST with `SWELTE_CSRF_CHECK_ORIGIN=1` →
  403; `OPTIONS` with origin → 204; `POST ?_method=DELETE` →
  verb dispatch; `/router/` ↔ `/router` 301s under
  `trailingSlash: 'always'`; `X-Swelte-Version` header present.
  Promote each to `docs/example.md` "Proved" as asserted.

## 11. `#app/paths` + `#app/environment` virtual stubs

* What: generated `.swelte/paths.js` (`base`, `assets`) +
  `.swelte/environment.js` (`browser`, `dev`, `building`,
  `version`) from config, with ambient decls.
* Engine: `vite.ts` `loadConfig` → `writeFileSync(paths.js /
  environment.js / version.js)`.
* Gap: generated on every build but never imported by any demo
  file. Non-default `base`/`assets` unproved.
* Demo: import `{ base }` + `{ version, browser }` in
  `/router/+page.svelte` footer (`{base}/router · v{version} ·
  browser={browser}`) and set a non-default `base: '/app'` in a
  second config comment — or assert defaults render (`''` base,
  package.json version). One line in `docs/example.md`.

## 12. `isPageError` / `isPageData` narrow helpers

* What: `loadPage` result narrowers (`sdk.ts:420-427`) alongside
  the `SwelteLoadResult` union.
* Engine: `sdk.ts:420-427`.
* Gap: `admin/+page.svelte` checks `result?.error` /
  `result?.data` inline instead of the narrowers.
* Demo: trivial — switch `admin/+page.svelte` to
  `isPageError(result)` / `isPageData(result)` and note it here.
  Smallest item on this list; good first commit.

## 13. Backend-only `#lib/` import guard

* What: `src/lib/**/backend/*.v` (or `*_backend.v`) is a build
  error from browser/`#lib/` WASM imports; same V compiles
  native + WASM for non-backend `#lib/` (`docs/rpc.md:31`,
  `docs/types.md` warns).
* Engine: generate-time `isBackendMod` / `isLibServerPath`
  (`sdk.ts:671-679` + vite diagnostics).
* Gap: `src/lib/backend/secrets.v` exists but nothing imports
  it — the guard never fires in the demo, so the "build error"
  half is unproved (only the existence half).
* Demo: a one-line negative proof — a scratch import of
  `#lib/backend/secrets.v` from a `.svelte` file must fail
  `swelte check` with file+line; record the error text in
  `docs/example.md` and delete the scratch import. Do NOT wire
  it into a shipping route (it must stay unimportable).


