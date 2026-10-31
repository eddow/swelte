# Roadmap (open items only)

Built (summary, details in git history + `docs/`): dispatcher + `SwelteRequest`
(query/form/headers/cookies/method/path/qualifier/params/files) + time unix wire
+ one-default-per-verb / unique-qualifier errors; `swelte dev|build|preview|init`;
V-WASM dev micro-modules + prod bundle; `+route` V dispatcher half + `before`/`after`
middleware; dynamic `[id]` / `[...rest]` (params decoded, stub interpolation);
trailing-slash strip + `/api/*` JSON 404 + single-global `+error` guard;
cookie session + CORS opt-in + CSRF; rate-limit + body cap + handler timeout;
no-JS `303` / HTML errors; multipart filenames; SSE (`@[sse]`, veb streaming);
`#lib/backend` guard + `#routes/*.v`-only import (generate-time file+line);
unique-basename `./x.v` aliases; `#lib/` allowlist
as generate-time error; six verbs live-proven; `swelte check` (text + `--format json`);
single-artifact `dist/` + binary proof; `+route.svelte` client router
(`.swelte/routes.js` + `mountSwelteRoute`, no manual imports);
`swelte test` (V tests + stub-match + snapshot drift + tsc);
HMR routes-stub + importer invalidation. `docs/` describes built behavior;
`.v`-import rationale in `v-imports.md`.

## 9 / SSR. Engines (adapter-owned; core provides manifest + Hand hook)

Built: slash strip, `GET /api/*` JSON 404, nested `*/+error.svelte` build error.
Phase 1 (core, engine-agnostic): `.svelte` route manifest (`svelteRouteFor` /
`collectSvelteManifest` → `.swelte/ssr-manifest.json`), cross-extension
double-claim (`foo.svelte` vs `foo/+page.*`), `routes.js` union (svelte-only
entries + `hydrateSwelteRoute`), `Hand` SSR hook (`SWELTE_SSR`/`SWELTE_SSR_URL`
gate, default SPA fallback), marker injection in `transformIndexHtml`,
generated client entry (`.swelte/entry-main.ts`), `swelte check` parity
(union clash + nested `+error` warn).
Phase 2 (`@swelte/ssr-qjs`): real SSR compiler (per-route `generate: 'server'`
+ Rollup bundle, `node:`-free verified), QJS-compat + top-level stub-call
guards (AST, file+line), SDK-import throw-stubs, two runtime shims,
`emitRenderJs` (dev + prod), dev sidecar + `runSsrDev`/`runSsrCheck`,
`swelte()` wrapper emitting `dist/ssr/render.js` in `generateBundle`.
Phase 3 (`@[load]` cascade): typed `parent` threading, chain validation,
wrapper struct decls, sandbox demo, documented in `rpc.md`.
Open: `qjsc` bytecode + V C-interop link + timeout/mem caps, dev `swelte dev`
auto-sidecar UX, `ssr-bun` sidecar, §5 gate as CI.

Test: per-adapter `runSsrCheck` (HTML render + markers); full §5 (404 HTML,
strip parity, `!T` → 500, bare-machine single artifact, HMR no-restart,
bun streaming) at QJS-link time.

## 23. V runtime as static vlib (deferred, post-freeze)

Keep emitting `SwelteRequest` + `err_*` from `generate()` until shape freezes; then ship
static `engine/core/vlib/request.v` copied verbatim (content-hashed, no `-I` into
`node_modules`).

Test: delete `.swelte/routes/`, rebuild — `Request` hash unchanged; build works off the copy.
