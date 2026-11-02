# Illustrations — remaining work

Source: `docs/specs/illustrations.md`. Closed and proved in
`docs/example.md`: 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15d, 15f. What follows is only what is
still unproved, plus the constraints found while implementing the
closed items.

Status 2026-11-02: all five Gotchas below are FIXED in the engine
(scratch the workarounds — write plain code). Everything from §10 on is
untouched.

## Gotchas (fixed — do not work around)

* A svelte-only page still needs a dispatch arm: a lone `@[load]` `.v`
  emits a **405-only** dispatch arm (`emitRouteFile` strips loads, so
  `verbs=[]` → `swelte_method_not_allowed()` on every verb — see
  `dispatchBody` `methodGate`, `vite.ts:2526`). Bare GET is 405 JSON and
  an HTML navigation on a 405 maps to the error page, not the leaf —
  so the page never serves HTML 200. Ship a trivial `@[get]` probe arm
  (see `router/tags/+page.v`) so the URL serves HTML 200 + SSR.
* Never write a full `@[verb]` attribute on its own comment line
  directly above a real attribute in a `.v` file — FIXED 2026-11-02:
  `parseVFile` blanks `// @[..]` comment lines before the
  stacked-attr merge, so `// @[sse]` over a real `@[get]` parses as
  get-only (real multi-line stacks still fan out;
  pinned in `bunch1.test.ts`). Write comments freely.
* Mixed emit+list `@[sse]` in one file is unservable
  (`swelte_sse_is_emit()` returns one per-file bool,
  `vite.ts:2415-2416`). One mode per file.
* Avoid `@swelte/core` even in `.svelte` **comments** — FIXED
  2026-11-02: `stubSdkImports` (`engine/ssr-qjs/src/ssr.ts`) now
  skips matches whose line-start holds a `//` outside string
  literals, so commented-out imports survive untouched (pinned in
  `bunch1.test.ts`). Write comments freely.
* Baseline: `tsc --noEmit` on `examples/something` — FIXED 2026-11-02:
  was failing on generated `.swelte/entry-main.ts` (TS2554, 2-vs-3
  args); the entry now passes explicit `undefined` and generate()
  emits an adjacent `entry-main.d.ts` declaring `errorProps?`
  optional, so user `tsc` is clean (verified after rebuild; pinned in
  `bunch1.test.ts`). If it regresses, that is a new bug, not this file.
* `docs/specs/illustrations.md` engine line numbers are stale
  (sdk.ts drifted ~+40-90). Current anchors: `loadPage` 464,
  `depends`/`invalidate` 610-623, `isFail` 675, `deserialize` 698.
  Refresh with `grep -n` before citing.
* When promoting to `docs/example.md`, tag lines with `(item N)`.

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
  `docs/example.md` as asserted. 15d + 15f are CLOSED (see Proved);
  15a/15b/15c/15e remain.

