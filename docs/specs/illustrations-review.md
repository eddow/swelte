# Illustrations — remaining work

Source: `docs/specs/illustrations.md`. Closed and proved in
`docs/example.md`: 1, 2, 5, 6, 11, 12. What follows is only what is
still unproved, plus the constraints found while implementing the
closed items.

## Gotchas (apply to everything below)

* A svelte-only page still needs a dispatch arm: a `.v` with only
  `@[load]` yields no arm — bare GET is 405 / HTML is 404. Ship a
  trivial `@[get]` probe arm (see `router/tags/+page.v`) so the URL
  serves HTML 200 + SSR.
* Never write the literal `@[sse]` in a `.v` comment — the parser
  treats it as a second attribute (one-default-per-verb build error).
  Use the single-quote form in comments.
* Mixed emit+list `@[sse]` in one file is unservable
  (`swelte_sse_is_emit()` is per-file). One mode per file.
* Avoid `@swelte/core` in `.svelte` comments — it lands in the
  compiled output next to the real import and widens the
  `stubSdkImports` regex surface.
* Baseline: `tsc --noEmit` fails on generated `.swelte/entry-main.ts`
  (2-vs-3 args) with zero local changes — pre-existing, unrelated to
  demo edits.
* `docs/specs/illustrations.md` engine line numbers are stale
  (sdk.ts drifted ~+40-90). Refresh with `grep -n` before citing.
* When promoting to `docs/example.md`, tag lines with `(item N)`.

## 3. `loadPage()` error branch

* Only the trigger is missing — `admin/+page.svelte` already renders
  the branch (via `isPageError`/`isPageData`). Cheapest: a force-fail
  button on `/admin`. Alternative: a `/router/throw` leaf with an
  always-throwing `@[get]` + `loadPage` on mount; it needs a probe
  `.v` arm per the gotcha above.

## 4. `isFail()` + `deserialize()`

* `@[post('save')]` 422 fail-lite arm returning
  `{ ok: false, fieldErrors: {...} }` + a `?save` form with
  `if (isFail(e, 422))` inline branch, plus one
  `deserialize(await fetch(...))` envelope assert. Keep the two
  asserts independent — this does not depend on item 15.

## 7. Custom matchers + `[id=matcher]`

* `src/matchers.v` `slug` in the portable subset only
  (`for c in s.bytes()`, byte compares, early returns; no
  `time`/`os`/`net` imports) + `users/[id=integer].v` +
  `posts/[slug=slug].v`. Assert 200 vs 404 on V dispatch and client
  `matchSegs`, `Params: number` for the integer leaf. Keep
  `users/[id].v` during transition (renaming changes the existing
  `/users/abc` 404 reason); update the `example.md` line together.

## 8. Route groups `(group)` + optional `[[slug]]`

* `(mkt)/+page.svelte` strip check + `docs/[[slug]]` pair asserting
  zero-or-one (`/docs` + `/docs/x` → 200, `/docs/x/y` → 404).
  The `(mkt)` leaf must not collide with existing `/`
  (one-file-per-URL rule) — use a distinct path or document the
  shadowing.

## 9. `src/app.v` lifecycle

* `src/app.v` with `@[startup]` boot stamp + `@[reroute]` rewriting
  `/old` → `/router`, served without redirect. Zero/one fn each, no
  qualifier/params; throw aborts boot. Keep `@[cron]`/`@[queue]` out
  (→ `specs/moar.md`). Touch the `example.md` Layout block when this
  lands (it currently says `src/app.v` is absent).

## 10. Request hardening knobs

* One `/router/limits` doc block with curl asserts, promoted line by
  line: `?slow&ms=12000` → 500 + server alive; 121 rapid hits → 429;
  cross-origin POST with `SWELTE_CSRF_CHECK_ORIGIN=1` → 403; OPTIONS
  with origin → 204; `POST ?_method=DELETE` → verb dispatch;
  trailing-slash 301s under `trailingSlash: 'always'`;
  `X-Swelte-Version` header present. For the rate probe, allow a
  lowered `SWELTE_RATE_LIMIT` and record the env used (121 hits is
  slow/flaky in CI).

## 13. Backend-only `#lib/` import guard (negative proof)

* One-line proof only: scratch-import `src/lib/backend/secrets.v`
  from a `.svelte` file; `swelte check` must fail with file+line;
  record the error text in `docs/example.md`; delete the scratch
  import. Never wire it into a shipping route.

## 14. Opt-in service worker (throwaway pass)

* Keep default OFF. Prove in a throwaway pass, then revert:
  `SWELTE_SW=1 swelte build` → `dist/sw.js` exists with `SW_PRECACHE`
  shell+hashes; `dist/index.html` carries the register snippet;
  `curl /sw.js` → `200 application/javascript`; default rebuild drops
  both. Record the four asserts in `docs/example.md`.

## 15. SvelteKit remainder (split: 15a–f, close independently)

* 15a `use:enhance`: `/router/enhance` leaf, plain `<form method=post
  use:enhance>` asserting `page.form` publish + reset without reload.
* 15b prerender: `prerender.entries: 'static'` throwaway build,
  `dist/about/index.html` exists while `dist/index.html` stays the
  shell.
* 15c ISR: `isr: { '/about': 60 }`, s-maxage headers on `GET /about`.
* 15d targets: `--target node|edge|static` shim file each.
* 15e offline: `offline.fallback` → `dist/offline.html` + SW precache.
* 15f export: `swelte export` → `snapshot/snapshot.json` pages list.
* Precedent: item 14's throwaway pattern — do not ship these knobs in
  `svelte.config.js`, prove then revert. Promote each line to
  `docs/example.md` as asserted.

