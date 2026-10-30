# Roadmap (not built, unless marked built)

Ordered. Each item is a delta from `docs/` (which describes what is
built: `.v` imports, codegen, envelope, example). Unmarked items are
not implemented; items leave this file when they land in `docs/`.
The `.v`-import design rationale lives in `v-imports.md` (§1–§5 built,
§6 decisions log).

Items 1–7 (dispatcher, dev, build, preview, init, V-WASM, +route
wrappers + middleware), 15-part
(one-default-per-verb + unique-qualifier as build errors), 18-part
(`time.Time→number`; allowlist enforced at build for `#lib/` WASM,
runtime-warn remainder only for the known-broken wasm-backend stdlib),
22-part (parser + `__swelteFetch` + stubs accept
`put`/`delete`/`patch`) are built.
Route params in `Request`, `swelte check` machine-readable output,
and per-item remainders below are still open. §7's V dispatcher half
is built; the `+route.svelte` UI half is manual composition until a
client router lands (§7 Test note). Item 23 records the
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

## 2. `swelte dev` orchestration — built (2026-10-29)

One command: free ports, spawn `v run .` + Vite with injected
`vBackendUrl`, restart V on `.v` change, kill both on Ctrl-C.
`vite.config.ts` reads `SWELTE_V_BACKEND_URL` (dev-injected) with a
`http://localhost:8131` fallback so plain `npx vite` still works.
CLI shape (decided 2026-10-29): single `swelte` bin for everything
(`dev | build | preview | init | check`); logic lives in `src/cli.ts` +
`src/commands/*.ts` (TS, tsc-ed, sharing `src/` internals),
`bin/swelte.js` stays a ~5-line shim (npm needs a runnable file before
`tsc` runs). `bin/` is gitignored (regenerable). Kill strategy:
by-port (`fuser -k`) + by-command (`pkill -f`) + handles, because
`npx`/`v run` wrappers re-parent the real servers out of
`ChildProcess` reach. Pre-generate: `dev` runs the plugin's
`configResolved` once before starting V so `routes/` exists.
Interactive shortcuts (TTY only — signals always work): `r` + Enter
restarts the V backend (Vite keeps HMR state), `u` + Enter restarts
Vite, `q` + Enter quits. `killBackend` waits for the backend port to
free (not just the `v run` wrapper exit) so restarts never EADDRINUSE.

Test: `node engine/core/dist/cli.js dev --port 5179 --backend 8148`
brings up both (`ready: http://localhost:5179`), HTML + proxied
`GET /api/greet` + `POST login` + `POST /` all correct through Vite;
`.v` touch triggers `#N` backend restart with no EADDRINUSE;
`r`/`u`/`q` shortcuts proven under a pty (restart V, restart Vite,
quit with exit 0 and both ports freed); SIGINT frees both ports and
the supervisor exits.

## 3. `swelte build` — built (2026-10-29)

`v -o` typecheck → `generate()` (`.swelte/` + `routes/`) →
`vite build` → `v -o dist/server` → smoke probe. Order matters:
`vite build` wipes `dist/`, so the binary is compiled AFTER it
(`0.5.2` has no `v check`; typecheck is `v -o .swelte/typecheck`,
removed after). Binary lives in `dist/` (prod-adjacent) — never the
project root. WASM step skipped (item 6 open). Smoke: boot
`dist/server` with `SWELTE_DIST=dist`, `GET /` → 200,
`GET /api/greet` → greeting, then kill.

Test: `swelte build --root examples/something` → `dist/server` +
`dist/index.html`, zero tsc/vite errors; root shows no binary.

## 4. `swelte preview` — built (2026-10-29)

Run the built V binary only: serves `dist/` + API routes on one port.
No Vite involved (vite-less prod run). `server.v` serves static via
`SWELTE_DIST` (`mime` types, `..` guard, SPA fallback to
`index.html`); `/` is always static in prod (the `@[get]` default on
`/` answers only in dev, where `SWELTE_DIST` is unset). `q` + Enter
quits (TTY), signals always work.

Test: `swelte preview --port 4175` after build → `/` renders HTML,
unknown path falls back to `index.html`, `/api/greet` + `login`
answer, asset serves `text/javascript`; only the V binary listens.

## 5. `swelte init` / `create` — built (2026-10-29)

Scaffold: `vite.config.ts` (env-aware `vBackendUrl`), `svelte.config.js`,
self-contained `tsconfig.json` (no repo-root extend — works out-of-tree),
wildcards (`#routes/*.v` / `#lib/*.v` → `.swelte`), `index.html`,
`src/{main.ts,app.html,routes/+page.{svelte,v},routes/api/greet.v,lib/crypto/hash.v}`,
`server.v` (Hand + static serving + main), `package.json` scripts,
`.gitignore` (`routes/` + `dist/` + `server`).

Test: `swelte init /tmp/probe-app` → 13 files; `cd` in, `npm
install`, `swelte build` → `dist/server` + `dist/index.html` with
smoke `page 200 + api ok`; `swelte preview --port 4175` → `/` HTML
200, unknown path SPA-falls-back to `index.html` 200, `/api/greet`
+ `login` answer, asset `text/javascript`; no `vite` process owns
the port (binary only).

## 6. V-WASM real compile (`#lib/`, dual pipeline) — built (2026-10-30)

Dev: per-file micro-modules (`.swelte/dev/<mod>.wasm`), HMR-scoped
rebuilds (mtime-guarded; watcher invalidates the importing stub so
Vite swaps only that module). Prod: single bundle
(`dist/assets/app_lib-<hash>.wasm`, exactly one `*.wasm` in
`dist/assets/`, 4.2KB for `hash_string`) compiled from a generated
`module main` entry concatenating only the client-imported `#lib/`
files (tree-shaking: every `.v` import resolved through the plugin
is recorded; untouched helpers never enter the bundle),
emitted via `generateBundle` + hashed-asset URL rewrite; stubs use
`/assets/app_lib.wasm` which the hook rewrites to the hashed file.
Bridge (`__swelteWasmCall`) drives `memory` + `main.<fn>` directly —
no JS glue, no JSON: numerics are i32 params/returns, strings marshal
as `{data ptr, len i32}` structs (params: ONE i32 pointer to the
struct; returns: caller-allocated hidden out-pointer passed FIRST,
`fn(rp, ...args)` → `undefined`). Each unit synthesizes `swelte_alloc`
(a clamped `malloc` wrapper — `malloc(0)` panics on wasm so clamped
to ≥1). Build errors with file+line: blocked imports (anything
outside the portable subset — enforced at build, roadmap §18), `?T`/
`!T` returns (wasm backend ICE), struct/array/map/i64/f64
params/returns (v1: flat string/int/bool only), duplicate fn names
across `#lib/` (one wasm namespace). Known V 0.5.2 backend gaps
(`strings`/`math` array-`.len` lowering, `crypto/*` transitive `io`,
C-backed `json`) are build errors too — surfaced as
`WASM compile failed: src/lib/...` instead of silent fallback. The
in-process `libFallbacks` registry remains only for
`hash_string` (dev convenience); everything else throws
`SwelteRpcError(status 0)`.
`v -b wasm -prod` needs `wasm-opt` (absent here) so prod ships
unoptimized — size target still met 20× over.

Test (dev): `swelte dev` → page 200, `/api/greet` JSON ok,
`/@swelte-dev/crypto/hash.wasm` 200 `application/wasm` 4208B;
`WebAssembly.Module.exports()` on it shows only `memory`,
`swelte_alloc`, `main.hash_string` (proves the real module, not the
byte-identical dev fallback); `hash_string('world')` →
`"hash(world)"`; `touch` the `.v` → micro-module timestamp updates,
others untouched.
Test (prod): `swelte build` → one `dist/assets/app_lib-*.wasm`
(4208B, target <100KB); `ls dist/assets/*.wasm` shows exactly one
file; an unimported `src/lib/crypto/unused.v` compiles to a dev
micro-module but is absent from the bundle exports (`swelte_alloc`,
`main.hash_string`, `memory` only); `GET /assets/…wasm` → 200 (V
binary serves it —
`server.v` maps `.wasm` → `application/wasm`); bundle call →
`"hash(world)"`; smoke `page 200 + api ok`.

## 7. `+route` wrappers + middleware (`before`/`after`) — built (2026-10-30)

`+route.svelte` / `+route.v` replace SvelteKit's `+layout.*` (no
`+layout` / `+page` / `+layout.server` / `+page.server` split): one
pair per directory wraps its subtree's pages and API routes.
Folder-root leaves are `+page.svelte` / `+page.v` (replacing
`index.*`: `foo/index.v` → `foo/+page.v`, same URL). So `/foo` has
two spellings with different wrapping: `foo.v` (unwrapped) vs
`foo/+page.v` (wrapped by `foo/+route.v`). Same for UI:
`foo.svelte` is not wrapped by `foo/+route.svelte`;
`foo/+page.svelte` is. Everything else stays as committed
(flat `foo.v → /foo`, `routeFor`, dispatcher).
The `.v` side adds middleware: `@[before]` fns run
root→leaf before the handler (transform-or-reject:
`SwelteRequest -> !SwelteRequest`); `@[after]` fns run leaf→root
after it (observe-or-replace the `(status, body)` response).
Global concerns (CORS/CSRF, rate-limit) stay in `server.v`'s `Hand`;
per-subtree auth/session is the motivating case.

Rules (locked): wrapping is directory-subtree (SvelteKit
semantics) over a pure ancestor walk — no sideways lookup.
`foo/+route.v` covers `foo/**/*` plus the folder-root `foo/+page`
leaf — never the sibling `foo.v` / `foo.svelte`. (`foo/+router.v`,
roadmap §8, will own `foo/**/*` — never `foo` itself.)
`foo.v` + `foo/+page.v` (or `foo.svelte` + `foo/+page.svelte`)
claiming the same URL is a build error, unconditionally — either
extension on either side (one file per URL, so guarded URLs live
inside their guard's directory).
Middleware fns are never exported to TS (file path already said the
kind), same as verb handlers; `+route.v` `pub struct`s ARE exported
to TS — the wrapper is +layout-shaped, so shared types (e.g. a
`load`-style shape) flow to `+page.svelte` via
`import type … from '#routes/foo/+route.v'`.

Test: `src/routes/admin/+route.svelte` (nav + `<slot/>`-style
`children` snippet) + `+route.v` (`@[before]` requiring a `sess`
cookie → 400 otherwise, `@[after]` pass-through);
`admin/+page.svelte`/`.v` leaf (`@[get]` echoing the user from
the injected `x-user` header). `GET /admin` without cookie → 400
`missing session` from the wrapper (proves the chain); with
`Cookie: sess=alice` → 200 `"admin:alice"`; `/` and `/api/greet`
unaffected (proves scoping). UI composition is manual until a
client router lands: the example's `admin/+page.svelte` imports
nothing from `+route.svelte` — the wrapper's nav/chrome is proven
by file presence + V chain, not by rendered nesting. Negatives:
`foo.v` + `foo/+page.v` → build error naming both files
(`foo.svelte` + `foo/+page.svelte` likewise, even with no `.v`
on either side); endpoints in `+route.v`,
`@[before]`/`@[after]` in leaves, and bad middleware shapes →
build errors naming file+fn.

## 8. Dynamic segments

`[id]`, `[...rest]` param flow into args structs.

Test: add `src/routes/users/[id].v` (`@[get]` echoing `id`) +
`.svelte`; `curl '…/users/42?payload="x"'` (or open `/users/42`)
returns `42`; `/users/` (missing segment) 404s.

## 9. Trailing-slash / 404 / `+error`

Conventions for slash handling, unknown-path 404 page, `+error` boundary.
SSR vs SPA fallback decision. The error boundary stays a single global
`+error.svelte` — explicitly NOT nested (no per-directory error
inheritance; `+route` wrappers compose UI, not error bubbling).

Test: open `/nope` (404 page, not blank/JSON); open `/api/greet/`
vs `/api/greet` (same handler per the decided convention);
throw from a handler → `+error` boundary renders, no white screen.

## 10. Auth/session

Cookies vs tokens, `Set-Cookie` on login, CSRF for `POST /`, CORS for
`/api/*`. (`#lib/` WASM has no network surface — server rules only.)
Per-subtree session guards land in `+route.v` `@[before]` middleware
(§7); global policy stays in `server.v`'s `Hand`.

Test: `login` sets a cookie (`curl -i` shows `Set-Cookie`);
replay the POST without it → 401/403; cross-origin fetch from another
port → blocked (or explicitly allowed) per the decided policy.

## 11. Hardening

Rate-limit, body size caps, timeouts. Global: enforced in `server.v`'s
`Hand`, not in `+route.v` middleware (§7 draws the line).

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

Orphan `routes/*.v`, `.v` outside
`routes/`+`lib/`, `#lib/backend` misuse, stray `@[get/post]` in `#lib/`,
duplicate verb defaults / duplicate qualifiers, `@[before]`/`@[after]`
outside `+route.v` — warn today (or unimplemented), none fail. Decide
warn-vs-error per case; emit machine-readable list with file+line.
Note: one-default-per-verb and qualifier uniqueness MUST be errors at
dispatcher time (ambiguous routing), so this item is really about the
rest. Decided (§7): folder-root double-claim (`foo.v` + `foo/+page.v`,
or `foo.svelte` + `foo/+page.svelte`) is a build error,
unconditionally — one file per URL, so guarded URLs live inside their
guard's directory.

Test: add an orphan `routes/stray.v` (no `.svelte` partner, not under
`api/`) → `vite build` fails with `stray.v:<line>` in the message;
fix it → build green. `swelte check` prints the same list as JSON
(`--format json`) with file+line per entry.

## 16. `#lib/backend` negative test

Guard is built (resolveId+load refuse with importer+file error);
unproven — needs a backend-only fixture + import-guard test.

Test: add `src/lib/backend/secrets.v` (or `src/lib/secrets_backend.v`); import it from `+page.svelte` →
build fails naming importer+file; import it from a `#routes/*.v`
only → build green. Also add `src/lib/backend/ui.ts` → build warns (no TS in backend/).

## 17. Relative `./x.v` editor types

Build works (`resolveId` handles relatives + alias-pre-resolved abs
paths); editors show the `*.v` fallback (`any`). Decide: `#`-only
(lint) or per-dir `paths` scoping.

Test: write `import { f } from './sibling.v'` in a Svelte file —
hover shows the real signature (not `any`); or the lint rule fires
telling you to use the `#`-alias form.

## 18. `#lib/` stdlib allowlist as build error

Set decided (`strings`, `math`, `encoding/*`, `crypto/*`, `json`,
`json2`; `#lib/backend/` exempt — see `v-imports.md` §2). Warns today;
enforce at build (error) once the V-WASM compile lands (§6).

Test: add `import os` to `src/lib/crypto/hash.v` → `vite build`
fails naming the file + banned module; same import under
`src/lib/backend/` → builds fine.

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
