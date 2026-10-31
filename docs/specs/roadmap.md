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
single-artifact `dist/` + binary proof. `docs/` describes built behavior;
`.v`-import rationale in `v-imports.md`.

## 7-remainder. `+route.svelte` UI composition (V half built)

V chain built; UI nesting is manual (leaf imports nothing from wrapper) until a
client router lands.

Test: leaf renders inside wrapper nav/chrome with no manual import.

## 9 / SSR. Engines (`specs/ssr.md` — dispatcher conventions built)

Built: slash strip, `GET /api/*` JSON 404, nested `*/+error.svelte` build error.
Open: `ssr-qjs` (default) + `ssr-bun` (opt-in) adapters, `hydrate()` template,
`Hand` SSR-or-static-or-SPA chain, `+error` HTML renders.

Test: per `ssr.md` §5 (404 `+error` HTML, strip parity, `!T` → 500 HTML, bare-machine
single artifact, HMR swap, bun streaming).

## 20. Testing story

`v test` for `.v` fns + TS contract tests against generated `.d.ts`.

Test: `v test src/lib/` passes; break a V return type → TS contract test fails pre-browser.

## 21. HMR for `.v` signature changes

Regen watches `.v`; Svelte remount on signature change unproven.

Test: with dev running, change a fn return type → browser remounts, no restart/stale stub.

## 23. V runtime as static vlib (deferred, post-freeze)

Keep emitting `SwelteRequest` + `err_*` from `generate()` until shape freezes; then ship
static `engine/core/vlib/request.v` copied verbatim (content-hashed, no `-I` into
`node_modules`).

Test: delete `.swelte/routes/`, rebuild — `Request` hash unchanged; build works off the copy.
