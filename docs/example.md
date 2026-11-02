# Example: something

Lives at `examples/something/`. Canonical demo of `.v` imports:
`#routes/` server RPC + `#lib/` isomorphic WASM + structured errors.
Built with `swelte build`, served with `swelte preview` (single
artifact: `dist/server` + `dist/`).

## Layout

```
src/routes/+page.svelte + +page.v   / (get_greeting GET, save_name POST)
src/routes/api/greet.v              /api/greet (get_greeting GET, greet_pure @[rpc] → Session, login POST → Session+cookie, pdf/created probes)
src/routes/boom/+page.svelte + +page.v   /boom (throw fixture: @[load] + @[get] both `return error('boom')` — SSR `!T` gate)
src/routes/users/[id].v             /users/[id] ([id] → req.params['id'])
src/routes/(mkt)/about.v            /about (item 8: route group — (mkt) is disk-only, stripped from URL; Params {} empty)
src/routes/docs/[[slug]].v          /docs/[[slug]] (item 8: optional segment — /docs + /docs/x → 200, /docs/x/y → 404; Params { slug: string })
src/routes/members/[id=integer].v   /members/[id=integer] (item 7: [id=integer] narrows Params.id to number; non-digits 404 on V dispatch)
src/routes/posts/[slug=slug].v      /posts/[slug=slug] (item 7: custom matcher — lowercase-alpha only, 200 vs 404 on V dispatch + client matchSegs)
src/matchers.v                      custom param matchers (@[matcher] (s string) bool, portable subset — for c in s.bytes(), byte compares, early returns, no time/os/net imports; `integer` builtin)
src/routes/files/[...rest].v        /files/[...rest] (catch-all → req.params['rest'])
src/routes/admin/+route.svelte + +route.v   /admin wrapper (nav + @[before] sess guard / @[after] passthrough)
src/routes/admin/+page.svelte + +page.v     /admin leaf (admin_whoami GET, reads injected x-user)
src/routes/router/+page.v + +page.ts + +page.svelte   /router (§1: server @[load] + swelte_fetch sibling rows + sync universal load + client router + $app/* + #app/* + $updated stub)
src/routes/router/live/+page.ts + +page.svelte        /router/live (§1: ssr=false twin — async universal load + <await> streaming, SPA shell)
src/routes/router/tags/+page.svelte + +page.v          /router/tags (item 1: depends/invalidate/invalidateAll tag registry — pure client, +page.v is a probe arm)
src/routes/router/enhance/+page.svelte + +page.v        /router/enhance (item 15a: plain <form method=post use:enhance> → page.form publish + reset, no reload)
src/lib/crypto/hash.v               isomorphic (hash_string @[rpc] → WASM/dev fallback)
src/app.v                           user lifecycle — @[startup] boot stamp + @[reroute] /old → /router (item 9; inlined into the harness)
.swelte/server.v                    Hand + static + main() — calls generated routes/swelte_route
routes/                             generated V dispatcher (regenerating, gitignored)
vite.config.ts                     swelte({ vBackendUrl, routesDir, libDir }) + experimental.async (client <await>; SSR bundle stays sync)
```

## Run

```sh
node engine/core/dist/cli.js dev --port 5174 --backend 8131 --root examples/something
# one command: V backend :8131 + Vite :5174, HMR reload on .v change, Ctrl-C kills both
# manual two-terminal equivalent:
#   PORT=8131 v run .swelte         # V backend :8131 (generated .swelte/server.v + routes/)
#   npx vite --port 5174           # frontend :5174 → open it, not :8131
```

## Proved

- `/` GET/POST (`get_greeting`/`save_name`), `/api/greet` GET + `greet_pure @[rpc] → Session{id,user,remember,expires_at}` + `login POST → Session+cookie` (verb, HTTP) + `?pdf` (binary) + `?created` (201),
  empty payload → 400, unknown fn → 404 + available, `vite build` green.
- Page buttons: Greet / Save / Hash (`#lib` real WASM) / Login / Stream (`@[sse]` `tick_stream` emit mode) / List (`@[sse]` `tick_items` list mode) / Rename (`@[put]`) / Touch (`@[patch]`).
- SSE proven (true streaming via veb, both shapes): emit mode on `/api/greet` (`data: tick 1` ~0.5s pacing, `?wait_ms=500` proves zero buffering; plain JSON GETs keep hitting `@[get]` on the same URL) + list mode on `/api/ticks` (`[]string` `['a','b','c']` → `data: a/b/c` frames, identical `for await` consumption). Mixed emit+list in one file is unservable (per-file `swelte_sse_is_emit`), hence separate files — item 5 closed.
- `hash_string` compiles to real WASM (`v -b wasm -os browser`):
  dev `.swelte/dev/crypto/hash.wasm` + prod `dist/assets/app_lib-*.wasm`.
- Generated dispatcher proven: `routes/_page.v` + `routes/api_greet.v` + `routes/api_ticks.v` +
  `routes/admin__page.v` + `routes/server_gen.v` (`module routes`,
  `SwelteRequest` + `swelte_route`), full verb set (`get/post/put/patch/delete` — item 6 closed:
  `PUT /api/greet` → `"renamed:alice"`, `PATCH` → `"touched:bob"`, 405 arm quiet) +
  unique-qualifier enforced at generate time.
- Dynamic segments proven: `/users/42` → `"user:42"`, `/users/` + `/users` →
  404, `/files/a/b/c` → `"files:a/b/c"` (`req.params`; static beats
  dynamic, `[...rest]` last).
- Groups + optional proven (item 8): `(mkt)/about.v` serves `/about`
  (`"about:mkt-group"` — the `(mkt)` segment strips disk-only via
  `stripRouteGroups`, `RouteId "/about"`, empty `Params`; a group-only
  `(mkt)/+page` would claim `/` and double-claim against the existing
  `/` leaf, so the demo uses a distinct path); `docs/[[slug]].v` serves
  `/docs/[[slug]]` (`"docs:" + slug` — `slug ''` on `/docs`, the segment
  on `/docs/x`, no match on `/docs/x/y` per the generated
  `swelte_match_route` optional-last-segment arm). Build green with both
  leaves (match/no-match read off `server_gen.v` dispatch arms; no `v`
  binary in this env for a live curl — same `swelte_match_route` table
  the `/users` + `/files` curls already prove).
- Matchers proven (item 7): `/members/42` → `"member-int:42"`, `/members/abc` →
  404 (`[id=integer]` narrows `Params.id` to `number` on the client via
  generated `.d.ts`, digits-only on V dispatch via `swelte_matcher_check`);
  `/posts/hello` → `"post:hello"`, `/posts/Hello123` → no match (custom `slug`
  matcher from `src/matchers.v` — portable subset transpiled to both the V
  `swelte_matcher_slug` fn and the client `__swelteMatcherFns.slug` used by
  `matchSegs`); same-dir `users/[id]` vs `users/[id=integer]` correctly
  rejected as same-dynamic-shape build error, hence the integer leaf ships
  under `members/`; fixed 2026-11-02 (`collectPrerenderEntries` called
  `routeFor` without the matcher set, so every custom matcher failed the
  build as `unknown matcher 'slug' (known: integer)` — now loads
  `loadMatchers(root)` into the crawl, pinned in `route-helpers.test.ts`).
  `Examples/something` build green with both matcher leaves (match/no-match
  read off the generated `server_gen.v` `swelte_matcher_*` arms +
  `routes.js` `__swelteMatcherFns`; no `v` binary in this env for a live
  curl — the binary dispatch path is the same `swelte_match_route` table
  the `/users` + `/files` curls already prove).
- Uploads proven: multipart `POST /api/greet?upload` reads `req.files['file']` (fallible `!string`) → `"got:<name>"`; only filenames kept (bytes parsed then discarded, never persisted); JS stubs send `File`/`Blob` args as `FormData`; 5MB under the 10MB `SWELTE_BODY_LIMIT` cap → 200; over-cap body → 413.
- Throw fixture proven (`/boom`, SSR `!T` gate): `@[load]` throws + `@[get]` throws → JSON `400 {"error":"boom"}` (bypass intact), HTML `400` +error render (marker, status), server stays up (`/` → 200 after); verified bare-machine (`SWELTE_SSR=1`, no sidecar) and sidecar-via-Hand via `runSsrCheck(throwRoute: '/boom')`.
- No-JS proven: `Accept: text/html` POST → 303 + `Location` on success, rendered HTML error on failure; `Accept: application/json` keeps JSON (same handler, content-negotiated). Page has plain `<form method=post>` variants (save + upload).
- Middleware chain proven: `admin/+route.v` `@[before]` rejects without
  `sess` cookie (400 `missing session`), injects `x-user` otherwise;
  `@[after]` passes through; `/` + `/api/greet` unaffected (scoping).
  Folder-root double-claim (`foo.v` + `foo/+page.v`, or `foo.svelte` +
  `foo/+page.svelte`, either extension on either side) is a build error.
  Error matrix: unknown fn → 404 + available, bad JSON → 400,
  missing fn → 400, `!T` → 400 `err.msg()`, unknown path → 404,
  method without handler → 405.
- §1 data-loading / client-router (`/router`, `/router/live`, `/router/tags`): server
  `@[load]` paints initial props + pulls sibling rows in-process via
  `swelte_fetch` (V-only, non-fallible, cookie/auth forwarded — all async
  lives in `.v`, `.svelte` top level stays pure-sync per the SSR guards);
  sync universal sibling `+page.ts load({ params, props, url })`
  (typed TS — ssr-qjs `transpileSiblingLoad` strips types before the
  QJS bundle, mirror of the `.svelte` preprocessing step)
  merges a view-model in `renderRoute` before render
  (`applyUniversalLoad`, `LOADEDMODS['/router']` in `dist/ssr/render.js`);
  client router (`goto` / `preloadData` / `pushState` /
  cancellable `beforeNavigate` in `onMount` / `afterNavigate`,
  `page` / `navigating` / `updated` stores, `$app/stores` +
  `$app/navigation` aliases) navigates without reload, preloaded JSON merges as
  `leafProps = { params, ...data }`; `ssr=false` twin `/router/live`
  (sibling `export const ssr = false` → `swelte_no_ssr()` → SPA shell,
  `hasUniversalLoad: 'async'` excluded from `render.js`) resolves its
  async universal load + `<await>` boundary client-side
  (client bundle compiles with `experimental.async`;
  the SSR `generate: 'server'` pass still rejects top-level await —
  `swelte check` clean);
  tag registry (`/router/tags`, item 1 closed: `depends('user')` /
  `invalidate('user')` selective re-run + `invalidateAll()`, HTML 200 via
  probe-arm `.v`, no full `goto`);
  `updated` stub-lit (item 2 documented: renders `false`, never flips —
  no version feed yet);
  `#app/paths` + `#app/environment` (item 11 closed: `{base}/router ·
  assets · v{version}` footer, defaults `''` + package.json version);
  `isPageError` / `isPageData` narrowers (item 12 closed: `admin/+page.svelte`
  uses the narrowers instead of inline `result?.error`).
- Backend-only guard proven (item 13: scratch `import lib.backend.secrets`
  in `#lib/crypto/hash.v` → build error `[swelte]
  src/lib/crypto/hash.v:3: imports backend module 'lib.backend.secrets' —
  only #routes/*.v may import #lib/backend (V-to-V include at codegen
  time)`; scratch deleted, file restored. `.svelte` never reaches the
  guard (no `.v` import channel); `#routes/*.v` importing backend is the
  allowed V-to-V include).
- `loadPage` error branch (item 3 closed: `admin/+page.svelte` `forceFail()`
  throws client-side → `loadPage` maps plain throw to `{ error: 500 }` →
  `<ErrorPage status message>` branch renders, no full-page SSR `+error`;
  SDK pinned, `tsc` clean, no live server needed).
- Fail-lite + envelope (item 4 closed: `/` `@[post('save')]` `save_fail` 422
  `{ ok: false, fieldErrors }` on empty payload → `saveFailLite()` narrows
  inline with `isFail(e, 422)`; independent `deserEnvelope()` asserts
  `deserialize()` on a synthetic SvelteKit failure envelope — never call it
  on raw verb JSON, raw bodies go through `__swelteActionResult`).
- Targets proven (item 15d: `writeTargetShim(root, 'dist', target, isr, log)`
  — `auto` writes no extra files, `static` → `dist/.swelte-static`,
  `node` → `dist/Dockerfile.swelte` (runs `dist/server`), `edge` →
  `dist/_headers` with longest-prefix `Cache-Control: public, max-age=0,
  s-maxage=N` per ISR entry; packaging-only, pinned in
  `export-snapshot.test.ts`).
- Export proven (item 15f: `runExport` on the demo tree reuses
  `.swelte/entries.json` → `snapshot/entries.json` + copies every
  `dist/**/*.html` → `snapshot/pages/<rel>.html` + copies
  `swelte.contract.json` + writes `snapshot/snapshot.json`
  (`{ version: 1, target, pages[], at }` — `pages[]` lists dist-relative
  `.html` paths); demo run yields 1 page (`index.html`, prerender off so
  no additive HTML yet); throwaway `snapshot/` deleted after assert).
- Service worker proven (item 14): `SWELTE_SW=1` throwaway `vite build` →
  `dist/sw.js` with `SW_PRECACHE ["/", "/assets/index-<hash>.js",
  "/assets/app_lib-<hash>.wasm"]` + `dist/index.html` carries the
  `serviceWorker.register("/sw.js")` snippet (auto mode); default rebuild
  drops both (no `sw.js`, no snippet). Fixed 2026-11-02: the wasm emit
  and the SW emit share one `generateBundle` hook — SW ran first so the
  bundle scan missed the late wasm emit; now the hashed
  `app_lib-*.wasm` name from `this.getFileName(ref)` is pushed into
  precache explicitly. Live `curl /sw.js → 200 application/javascript`
  not run here (no `v` binary) — the static-first exact-file arm in
  `server.v` (`dist + path` exists → serve with `application/javascript`
  for `.js`, ahead of Accept routing) is the serving path. `svelte.config.js`
  untouched (default OFF).
- Request hardening proven live (item 10, default binary + env overrides):
  `?slow&ms=12000` → 500 in ~10s + server alive (`/` → 200 after);
  `SWELTE_RATE_LIMIT=3` → hits 1–3 are 200, hit 4 → 429 (`count > limit`
  after increment — set the env BELOW the hit count); cross-origin POST
  without `SWELTE_CORS_ORIGIN` match → 403 (CORS gate, `server.v:415` —
  not the `SWELTE_CSRF_CHECK_ORIGIN` knob, which is a second gate);
  OPTIONS with origin → 204 always; default trailing-slash `ignore` →
  no redirect (`/router/` → 200); `X-Swelte-Version` absent unless
  `SWELTE_VERSION` set (`=9.9.9` → header present); `POST
  ?_method=DELETE` without `SWELTE_METHOD_OVERRIDE=1` → normal dispatch
  (override OFF by default). Fixed 2026-11-02: the `swelte build` CLI
  silently no-opped (`import { swelte }` vs default export — generate
  never ran, exit 0); now falls back to the default export and fails
  loudly. Also fixed: `@[reroute]` inject assigned immutable `path` —
  template now declares `mut path`, and the `renderHarness` anchor
  matches it (previously emitted the "anchor missing" fallback, so
  `/old` 404'd instead of rewriting to `/router`).
- SvelteKit remainder closed (item 15): 15a `use:enhance` —
  `/router/enhance` leaf (`enhance_echo ?echo` POST arm returns the
  payload as JSON; live curl proves the arm) + plain `<form
  method=post use:enhance>` asserting `page.form` publish + reset;
  no-reload is structural (`preventDefault` + fetch, never navigates)
  and the SDK half is unit-pinned (`enhance` intercept / `applyAction` /
  cancel in `sdk-errors.test.ts`); SSR guard fixed to scan `<script>`
  blocks only (markup `use:enhance` no longer a build error). 15b
  prerender — throwaway `prerender.entries: 'static'` build writes
  additive `dist/router/live/index.html` (API-only routes like `/about`
  correctly skipped: no page → no HTML), root `dist/index.html` stays
  the shell. 15c ISR — `SWELTE_ISR="/router=60"` → `GET /router` HTML
  200 carries `Cache-Control: public, max-age=0, s-maxage=60` +
  `X-Swelte-Revalidate: 60`; JSON API untouched; fixed 2026-11-02 (the
  stamp sat below the SSR/static/shell early returns so it never fired —
  moved above them). 15e offline — `offline: { fallback: true }` writes
  `dist/offline.html` (best-effort from first crawled page). All three
  throwaway knobs reverted after assert (`svelte.config.js` clean).
  15d targets + 15f export proved earlier (see above).
- Lifecycle proven (item 9): `src/app.v` ships `@[startup] boot()` (no
  params, `void` — throw aborts boot) + `@[reroute] rewrite(host, path)`
  (`/old` → `/router`, `''` = no-op); generate inlines the bodies into
  `.swelte/server.v` (startup once before `veb.run`, reroute in
  `before_request` after the path split, before trailingSlash/CORS/static/
  dispatch). No `v` binary in this env for a live curl — proven by the
  generated harness arms + `loadServerHooks` shape pins in
  `generate-errors.test.ts` (startup/ reroute arity, qualifier, and
  return-type rejections).

## Stubs (see `rpc.md`, `types.md`)

Dev `/@swelte-dev/<mod>.wasm` micro-modules; prod single bundle
(`__swelteWasmCall` drives `memory` + `main.<fn>` directly).
