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

## 9 / SSR. Engines (`specs/ssr.md` — dispatcher conventions built)

Built: slash strip, `GET /api/*` JSON 404, nested `*/+error.svelte` build error.
Phase 1 (core, engine-agnostic): `.svelte` route manifest (`svelteRouteFor` /
`collectSvelteManifest` → `.swelte/ssr-manifest.json`), cross-extension
double-claim (`foo.svelte` vs `foo/+page.*`), `routes.js` union (svelte-only
entries + `hydrateSwelteRoute`), `Hand` SSR hook stub (`SWELTE_SSR=1` gate,
default SPA fallback), `app.html` SSR placeholders + hydrate-first `main.ts`,
`swelte check` parity (union clash + nested `+error` warn).
Phase 2 scaffold: `@swelte/ssr-qjs` package (re-exports core, manifest
composer, QJS-compat guard, `swelte()` wrapper, V shim stub).
Open: `generate: 'server'` compilation spike, dev disk-read bridge, `qjsc`
prod link, `ssr-bun` sidecar, `Hand` full chain.

Test: per `ssr.md` §5 (404 `+error` HTML, strip parity, `!T` → 500 HTML, bare-machine
single artifact, HMR swap, bun streaming).

## 23. V runtime as static vlib (deferred, post-freeze)

Keep emitting `SwelteRequest` + `err_*` from `generate()` until shape freezes; then ship
static `engine/core/vlib/request.v` copied verbatim (content-hashed, no `-I` into
`node_modules`).

Test: delete `.swelte/routes/`, rebuild — `Request` hash unchanged; build works off the copy.
