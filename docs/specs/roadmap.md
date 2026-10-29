# Roadmap (not built, unless marked built)

Ordered. Each item is a delta from `docs/` (which describes what is
built: `.v` imports, codegen, envelope, example). Unmarked items are
not implemented; items leave this file when they land in `docs/`.
The `.v`-import design rationale lives in `v-imports.md` (§1–§5 built,
§6 decisions log).

Items 1 (dispatcher), 15-part (one-default-per-verb + unique-qualifier
as build errors), 18-part (`time.Time→number`), 22-part (parser +
`__swelteFetch` + stubs accept `put`/`delete`/`patch`) are built.
Route params in `Request`, `swelte check` machine-readable output,
and per-item remainders below are still open. Item 23 records the
standing decision to keep the V runtime (`SwelteRequest`, `err_*`)
emitted until the shape freezes, then ship it as a static vlib.

## 1. Generated V dispatcher — built (2026-10-29)

`generate()` emits `routes/` (`module routes`: one file per routes
file + `server_gen.v` with `SwelteRequest` + `swelte_route`), shared
with `server.v` (`Hand` + static + `main()`) via directory-mode
`v run .`. Per file: `@[rpc]` dispatch by `"fn"` in the JSON body;
verb handlers dispatch by (method, qualifier) — default or `('q')`
matched against `?q` (error cases: unknown `fn` → 404 + available,
unknown qualifier → 404 + available qualifiers, missing `"fn"` → 400,
bad JSON → 400, `!T` → 400, method without handler → 405).
Includes: `SwelteRequest` (query, form, headers, cookies, method,
path, qualifier — route params open), `time.Time` unix wire,
form/multipart `?q` branch per file, one-default-per-verb validation
(two `@[post]` defaults = build error, duplicate qualifier = error).

Test: `cd examples/something && rm -rf .swelte && npx vite build`
(fresh `routes/server_gen.v` appears); `PORT=8131 v run .`
serves `/` + `/api/greet`; curl the probes from `docs/example.md`
(all 200/400/404 as documented, `expires_at` unix int); `v -o
/tmp/probe server.v` compiles with no warnings (dead `server.v`
route code gone). Qualifier check: `GET /api/greet?delete` →
`{"error":"missing qualifier"}` (no `@[get('delete')]` exists on the
file, so the dispatcher correctly rejects the unknown qualifier;
add one and it dispatches).

## 2. `swelte dev` orchestration

One command: free ports, spawn `v run server.v` + Vite with injected
`vBackendUrl`, restart V on `.v` change, kill both on Ctrl-C. Kills the
two-terminal dance. CLI shape (decided 2026-10-29): single `swelte` bin
for everything (`dev | build | preview | init | check`); logic lives in
`src/cli.ts` + `src/commands/*.ts` (TS, tsc-ed, sharing `src/`
internals), `bin/swelte.js` stays a ~5-line shim (npm needs a runnable
file before `tsc` runs). `bin/` is gitignored (regenerable).

Test: `node engine/core/bin/swelte.js dev` prints the V version +
stub plan and exits 0; `swelte bogus` exits 1 with usage;
`swelte check --help` lists `--root`.

## 3. `swelte build`

`v check` → `.swelte/` → `v -o .swelte/server` + `v -b wasm` (per `#lib`
file) → `vite build` → `dist/` + static-serving V binary. Binary lives
in `.swelte/` for dev, `dist/`-adjacent for prod — never the project root.

Test: `swelte build` in `examples/something` produces `dist/` +
`dist/server` (or `.swelte/server`), zero `tsc`/`vite` errors;
`ls` project root shows no new `server` binary.

## 4. `swelte preview`

Run the built V binary only: serves `dist/` + API routes on one port.
No Vite involved (vite-less prod run).

Test: stop Vite, `swelte preview --port 4173`; open
`http://localhost:4173` (page renders), click Greet/Login (API answers);
`ps` shows no `vite`/`node` server process — only the V binary.

## 5. `swelte init` / `create`

Scaffold: `vite.config.ts`, `svelte.config.js`, tsconfig wildcards
(`#routes/*.v` / `#lib/*.v` → `.swelte`), `.gitignore` for
`.swelte/` + `server` + `dist/`.

Test: `swelte init /tmp/probe-app && cd /tmp/probe-app && npm install &&
npx vite build` succeeds with zero manual tsconfig/vite edits;
`svelte-check` reports 0 errors.

## 6. V-WASM real compile (`#lib/`, dual pipeline)

Dev: per-file micro-modules (`.swelte/dev/<mod>.wasm`), HMR-scoped
rebuilds. Prod: single bundle (`dist/assets/app_lib.wasm`) from a
generated entry importing all client-used `#lib/` files,
`v -b wasm -prod` (LTO + DCE, <100KB target). Bridge
(`__swelteWasmCall`) masks the difference; importers never change.
First: one real `v -b wasm` proving (string/struct over the JSON
boundary, `!T` surfacing, allowlist, size report). (Dev fallback
works; no artifact compiled yet.)

Test (dev): edit `src/lib/crypto/hash.v`, save — Vite HMR swaps only
that module (<10ms recompile, page state preserved);
`.swelte/dev/crypto_hash.wasm` timestamp updates, others untouched.
Test (prod): `swelte build` emits one `dist/assets/app_lib.wasm`
(<100KB target); `ls dist/assets/*.wasm` shows exactly one file;
cold load in a clean profile works with network throttled to 3G.

## 7. Layouts

`+layout.svelte` / `+layout.v` inheritance semantics (nested layouts,
data flow down).

Test: add `src/routes/admin/+layout.svelte` with a nav + `+layout.v`
supplying a session prop; visit `/admin/*` — nav renders, prop flows
to both parent and child, non-admin routes unaffected.

## 8. Dynamic segments

`[id]`, `[...rest]` param flow into args structs.

Test: add `src/routes/users/[id].v` (`@[get]` echoing `id`) +
`.svelte`; `curl '…/users/42?fn=…'` (or open `/users/42`) returns
`42`; `/users/` (missing segment) 404s.

## 9. Trailing-slash / 404 / `+error`

Conventions for slash handling, unknown-path 404 page, `+error` boundary.
SSR vs SPA fallback decision.

Test: open `/nope` (404 page, not blank/JSON); open `/api/greet/`
vs `/api/greet` (same handler per the decided convention);
throw from a handler → `+error` boundary renders, no white screen.

## 10. Auth/session

Cookies vs tokens, `Set-Cookie` on login, CSRF for `POST /`, CORS for
`/api/*`. (`#lib/` WASM has no network surface — server rules only.)

Test: `login` sets a cookie (`curl -i` shows `Set-Cookie`);
replay the POST without it → 401/403; cross-origin fetch from another
port → blocked (or explicitly allowed) per the decided policy.

## 11. Hardening

Rate-limit, body size caps, timeouts.

Test: burst 100 POSTs in 1s → 429s after the limit; POST a 50MB body →
413; hang a handler → client gets a timeout error, server stays up.

## 12. No-JS form proof

Verb handlers are spec'd; prove end-to-end: no-JS `<form action="?q">`
→ `@[post('q')]` → redirect + error rendering without JS.

Test: disable JS in the browser, submit the login form — lands on the
redirect target with the session visible; submit empty → error text
renders server-side (no console, no JS).

## 13. File uploads

`multipart` handling, large bodies.

Test: upload a 5MB file through a form → `@[post]` handler; server
stores it, responds with size + name; browser shows both.

## 14. Streaming (SSE/WS)

README-era promise; `rpc.md` is silent. Either spec as v2-defer or
define now: which fns stream, wire format, reconnect, backpressure.

Test (if built): open a streaming route — chunks arrive progressively
in the browser (not one buffered blob); kill the server mid-stream →
client reports disconnect, reconnects per policy.

## 15. Validation strictness

Orphan `routes/*.v`, leaf-vs-index clash, `.v` outside
`routes/`+`lib/`, `#lib/server` misuse, stray `@[get/post]` in `#lib/`,
duplicate verb defaults / duplicate qualifiers — all warn today (or
unimplemented), none fail. Decide warn-vs-error per case;
emit machine-readable list with file+line. Note: one-default-per-verb
and qualifier uniqueness MUST be errors at dispatcher time (ambiguous
routing), so this item is really about the rest.

Test: add an orphan `routes/stray.v` (no `.svelte` partner, not under
`api/`) → `vite build` fails with `stray.v:<line>` in the message;
fix it → build green. `swelte check` prints the same list as JSON
(`--format json`) with file+line per entry.

## 16. `#lib/server` negative test

Guard is built (resolveId+load refuse with importer+file error);
unproven — needs a server-only fixture + import-guard test.

Test: add `src/lib/server/secrets.v`; import it from `index.svelte` →
build fails naming importer+file; import it from a `#routes/*.v`
only → build green.

## 17. Relative `./x.v` editor types

Build works (`resolveId` handles relatives + alias-pre-resolved abs
paths); editors show the `*.v` fallback (`any`). Decide: `#`-only
(lint) or per-dir `paths` scoping.

Test: write `import { f } from './sibling.v'` in a Svelte file —
hover shows the real signature (not `any`); or the lint rule fires
telling you to use the `#`-alias form.

## 18. `#lib/` stdlib allowlist as build error

Set decided (`strings`, `math`, `encoding/*`, `crypto/*`, `json`,
`json2`; `#lib/server/` exempt — see `v-imports.md` §2). Warns today;
enforce at build (error) once the V-WASM compile lands (§6).

Test: add `import os` to `src/lib/crypto/hash.v` → `vite build`
fails naming the file + banned module; same import under
`src/lib/server/` → builds fine.

## 19. Single-artifact deploy

`dist/` + binary as one deployable (V binary serves static + API;
no Node at runtime).

Test: copy `dist/` to a bare machine (no Node, no Vite, no source) +
run the binary → page + API both answer on one port.

## 20. Testing story

`v test` for `.v` fns + TS-side contract tests against generated `.d.ts`.

Test: `v test src/lib/` passes; break a V return type → the TS
contract test fails before any browser is opened.

## 21. HMR for `.v` signature changes

Regen already watches `.v` files; Svelte remount behavior on
signature change unproven.

Test: with `vite dev` running, change a fn's return type in `.v` —
browser remounts with the new type, no restart, no stale stub.

## 22. Extra HTTP verbs (`put`/`delete`/`patch`)

Table, qualifier rules, `Request` shape, and dispatcher branches are
spec'd (`v-imports.md` §3); parser + codegen + dispatcher implement
all six verbs (`rpc`/`get`/`post`/`put`/`delete`/`patch`) since
2026-10-29: extended attr regex, `__swelteFetch` kind + qualifier
arg, stub codegen, and the dispatcher method arms.

Test: add `@[delete('session')]` to a routes file; `curl -X DELETE
…/path?session` hits it; `curl -X DELETE …/path` (no qualifier)
hits the default or 404s per the file's handlers.

## 23. V runtime as static vlib (deferred, post-freeze)

`SwelteRequest` + `swelte_err_*` are emitted by `generate()` into
`routes/server_gen.v` (`emitServerGen`, `engine/core/src/vite.ts`).
Decided 2026-10-29: keep emitting until the shape freezes (route
params, §8, are still open). Then move the runtime to a static
`engine/core/vlib/request.v` (`module routes`) that `generate()`
copies verbatim into `routes/` — checked in with the package,
content-hashed. Rationale: emitted struct and constructor can never
drift (same generator run); a static copy needs a version handshake.
Do NOT point V at `node_modules/@swelte/...` via `-I` (breaks under
pnpm layouts, vendored installs). Related split, already built:
verb handlers take `SwelteRequest` and return a response;
`@[rpc]` fns take one args-struct (`docs/rpc.md` § Attributes).

Test (when frozen): delete `.swelte/routes/`, rebuild — `Request`
shape identical (content-hash of `routes/server_gen.v` unchanged
across runs); `swelte build` works with the vlib copy and no
emitted-runtime diff.

## Background

The original ecosystem sketch is preserved in git history under
`plans/swelte_framework_ecosystem_architecture_spec.md`. Superseded
where it conflicts with `docs/`; kept as context for
packaging/examples only.
