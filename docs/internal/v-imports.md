# Spec: `.v` imports — `#routes/` server RPC vs `#lib/` isomorphic WASM

Status: design reference (§1–§5 built) + decisions log (§6). §6 records
all 2026-10-29 decisions including the verb-vs-rpc handler split
(verb handlers: `SwelteRequest` in, response out; `@[rpc]` fns:
one args-struct).
`../rpc.md`+`../types.md`+`../errors.md` describe the built behavior;
this file is the design rationale and the undecided remainder.
Forward work lives in `../specs/roadmap.md` only.

## 1. Goal

Any `.v` file is an ES module. Any `pub fn` with an RPC attribute is
a named export. **Directory decides runtime; extension stays `.v`:**

```svelte
<script lang="ts">
  import { get_greeting } from '#routes/index.v';
  import { login } from '#routes/api/greet.v';
  import { hash_string } from '#lib/crypto/hash.v';
  import type { Session } from '#routes/api/greet.v';
</script>
```

* `#routes/**/*.v` = **server call** (fetch to the V backend).
  File path is the route, fn name goes in the body (`[@rpc]`).
  `+route.v` files are wrappers, not endpoints: their `@[before]` /
  `@[after]` middleware runs for the subtree (roadmap §7); middleware
  fns export nothing to TS, but the wrapper's `pub struct`s ARE
  exported (wrapper is +layout-shaped: shared types flow to
  `+page.svelte`).
* `#lib/**/*.v` = **isomorphic lib** (local WASM call, works offline).
  No route, no fetch. Same V source compiles to native (server) +
  WASM (browser); TS import is always `async` to unify both.

Deleted: `self` bare specifier, `$ssapi/*`, `$csapi/*`,
`sdk.post/get/worker.call` as user API, `@[expose]`, `src/pages/`,
`src/ssapi/`, `src/csapi/`, `src/api/`, `./$types` shims.
`@swelte/rust` is dropped — WASM stays V (`v -b wasm`), no Rust
package, no `*.rs` imports. Aliases follow SvelteKit: `#routes`, `#lib`.

## 2. File layout

```
src/routes/+page.svelte + src/routes/+page.v      route `/`
src/routes/about.svelte + src/routes/about.v      route `/about`
src/routes/api/greet.v                            route `/api/greet`
src/routes/api/admin/users.v                      route `/api/admin/users`
src/routes/admin/+route.svelte + +route.v         wraps `/admin/*` + `/admin`'s `+page` (nav + @[before]/@[after]; roadmap §7)
src/routes/admin/+page.svelte + +page.v           route `/admin` (folder-root leaf, ex-`index.*`)
src/lib/crypto/hash.v                             isomorphic, no route
src/lib/format.v                                  isomorphic, no route
```

### `#routes/` — server RPC

Rules (`routeFor`, once in `vite.ts`, reused by V dispatcher gen):

* `src/routes/<path>.v` -> `/<path>`, except `src/routes/api/**`
  -> `/api/**` (same string, kept explicit so API files need no
  `.svelte` partner).
* `index.v` -> `/` (or `/api/` under api — discouraged, warn).
  Renamed per §7: the folder-root leaf is `+page.v`
  (`foo/index.v` → `foo/+page.v`, `src/routes/index.v` →
  `src/routes/+page.v`, same URL). Both spellings still accepted
  (legacy back-compat); both present is a build error.
* `+route.v` is a wrapper, not an endpoint: it declares `@[before]` /
  `@[after]` middleware for its directory subtree (never a route of
  its own; never exported as callables to TS, but its `pub struct`s
  are — +layout-shaped shared types). `+route.svelte` is the matching
  wrapper UI (`<slot/>`/`children` + chrome; manual composition until
  a client router lands). Wrapping covers `foo/+page.*` and
  `foo/**/*` — NOT the sibling `foo.svelte` / `foo.v` (same for UI).
* Folder-root double-claim (`foo.v` + `foo/+page.v`, or `foo.svelte` +
  `foo/+page.svelte`) is a **build error, unconditionally** — either
  extension on either side (one file per URL, decided §7: guarded
  URLs live inside their guard's directory).
* Every routed `.v` must have either a `.svelte` partner (page) or
  live under `api/` (headless JSON). Orphan `routes/*.v` without a
  partner outside `api/` is a build warning (future: error).
* Dynamic segments (roadmap §8, built 2026-10-30): `[id]` matches one
  non-empty segment, `[...rest]` matches the remainder (must be the
  last segment, may be empty). Matched values flow into
  `SwelteRequest.params`; static routes win over dynamic, fewer params
  win over catch-all; a catch-all matches only when no static or
  narrower dynamic arm does (fallback, never a conflict).
  `files/+page.v` (`/files`) and `files/[...rest].v`
  (`/files/[...rest]`) coexist: `GET /files` hits the leaf, `GET
  /files/a/b` hits the catch-all with `rest='a/b'`, `GET /files` with
  no leaf hits the catch-all with `rest=''`.
  Per-extension independence: matching runs separately on `.svelte`
  routes (client router `matchSegs`) and `.v` routes (V dispatcher
  `swelte_match_route`) — `files/+page.svelte` owns HTML `GET /files`
  while `files/[...rest].v` owns JSON `GET /files` (`rest=''`) with no
  conflict. Same-folder `[...a]` + `[...b]` is a build error (one
  catch-all per dir).
  Build errors: malformed brackets, non-final catch-all, duplicate
  params, same normalized shape across files.

`src/routes/` is the rename of old `src/pages/`. `src/api/`
(previous revision) and `src/ssapi/` (implemented) both move here:
`src/ssapi/greet.v` -> `src/routes/api/greet.v`, route
`/ssapi/greet` -> `/api/greet`.

### `#lib/` — isomorphic WASM

* Any path under `src/lib/`. Never routed, never fetched, never
  appears in the V dispatcher or the dev proxy.
* Same V source must compile both ways: `v` native (unused on server
  for now, but kept importable) and `v -b wasm` (browser).
  Constraint decided 2026-10-29 (warn in dev, error at build):
  `#lib/` (non-`server`) may import only the portable subset —
  `strings`, `math`, `encoding/*`, `crypto/*`, `json`, `json2`.
  Anything else (`os`, `net`, `db`, `time`, …) is rejected.
  Escape hatch: `#lib/backend/` allows everything (backend-only,
  never compiled to WASM — see §7. No `.ts`/`.js`/`.svelte` under `backend/`: backend runs purely on V (decided 2026-10-29). The subset expands on demand
  when a real `#lib/` fn needs a module: add the module, not a
  per-file exemption list.
* One WASM blob per `.v` file (cache granularity, matches the
  one-file-one-module mental model). Shared `#lib` helpers without
  attributes are bundled into each importer (static link), not split.
* Runs on the importing thread (plain `async` call). Decided 2026-10-29:
  main thread, no Worker opt-in flag for now — revisit only with measured
  jank. Never a shared cross-module bus (the old `csapi` worker design
  is dead).

Sexy property this buys: the *same* `hash_string` V fn is unit-tested
natively (`v test`), served nowhere, and executed in the browser as
WASM. One language, one file, two targets.

## 3. Attributes

### Server (`#routes/`) — decided 2026-10-29

Each verb attribute IS the HTTP verb. One default fn per verb per file.
`@[rpc]` fns are the only named functions: many per file,
`fn` in the JSON body. Verbs dispatch by (method, qualifier) —
default or `('q')` matched against `?q`. `@[before]` / `@[after]` are middleware, only in
`+route.v` wrappers (middleware fns never exported to TS; the
wrapper's `pub struct`s are): `@[before]` fns run
root→leaf before the handler (`SwelteRequest -> !SwelteRequest`,
transform-or-reject); `@[after]` fns run leaf→root after it
(observe-or-replace the response). A rejected middleware
(`return error('msg')`) short-circuits the chain with
`400 {"error":"msg"}` naming the wrapper fn — the response is
always JSON, even for `@[after]` (a non-2xx `code` returned by
`@[after]` replaces the response as-is).

| attribute | HTTP | carrier | routing |
|---|---|---|---|
| `@[rpc]` | POST, JSON `Accept: application/json` | body `{ "fn", "args" }` | `fn` = V fn name; unlimited per file |
| `@[get]` / `@[get('q')]` | GET `Accept: application/json` | query = args | default, or `?q` present |
| `@[post]` / `@[post('q')]` | POST form (multipart / urlencoded) | form fields = args | default, or `?q` present |
| `@[put]` / `@[put('q')]`, `@[delete]` / `@[delete('q')]`, `@[patch]` / `@[patch('q')]` | respective method | same per-method rules | same |

* No attribute = internal helper, never exported, never routed.
* Verbs stack across methods (`@[get; post]` = both), but **one default
  per verb per file** — two `@[post]` defaults = build error.
  Qualifiers must be unique per verb per file.
  `@[rpc]` is unaffected (many per file, always).
* Qualifier syntax: `@[post('delete')]` — single identifier, single
  quotes. Trigger: `<form action="?delete" method="POST">` (SvelteKit's
  `?/delete` shape, without the slash). JSON POSTs never consult
  qualifiers; form POSTs never consult `"fn"`. Content-Type decides:
  `application/json` → `@[rpc]` dispatch by body; form content-type →
  verb dispatch by qualifier.
* Signatures differ by kind. `@[rpc]` keeps the single-args-struct rule
  (`pub fn login(args LoginArgs)`). Verb handlers take the framework
  `Request` (query, form fields, headers, cookies, route params —
  exact shape with the dispatcher, roadmap item 1):
  ```v
  @[post('delete')]
  pub fn delete_account(req Request) ! { ... }
  ```
* Per-fn, not per-file. `@[rpc]` is the JSON-SPA path; verbs are the
  linkable/cacheable (GET) and progressive-enhancement (form POST,
  no-JS `<form>` hits the same fn) path. Importers may still
  `import { delete_account } from '#routes/x.v'` — the stub POSTs the
  form encoding with `?delete`; or they use a plain `<form>` and skip
  JS entirely.

### Isomorphic (`#lib/`)

* `@[rpc]` = expose. Same spelling as server, different backend:
  local WASM call instead of fetch. No verbs — `@[get]`/`@[post]`
  in `#lib/` are build warnings (ignored, fn still exposed as RPC).
* No attribute = internal helper (static-linked, never exported).
* V signature rules identical to server: one args-struct,
  `!T` = may reject with `SwelteRpcError` (`status: 0`,
  `body.error = err.msg()`), `?T` = `T | null`.
  Single-args-struct expansion in TS unchanged.

Why the same `[@rpc]`? One concept ("callable across the boundary"),
two bindings (fetch vs WASM). The importer never cares which; the
file path (`#routes/` vs `#lib/`) already said it.

## 4. Compile time: what `import './x.v'` does

The Vite plugin already parses `.v` as text
(`parseVFile`/`parseStructs`); it now emits **two** artifacts per file
and branches codegen on directory:

### `#routes/*.v` -> fetch stub

Runtime `.swelte/generated/routes/<mod>.js`:

```js
// auto-generated from src/routes/api/greet.v — do not edit
import { __swelteFetch } from '@swelte/core';
export function get_greeting(args) {
  return __swelteFetch('/api/greet', 'get_greeting', 'get', args);
}
export function login(args) {
  return __swelteFetch('/api/greet', 'login', 'rpc', args);
}
```

`__swelteFetch(base, fn, kind, args)` (internal, in `sdk.ts`):
`rpc` -> `POST base {fn,args}` JSON; `get` -> `GET base?fn=&...args`;
`post` -> form `POST base?fn=`. Rejects with `SwelteRpcError`.

### `#lib/*.v` -> WASM stub (dual pipeline, built 2026-10-30)

Runtime `.swelte/generated/lib/<mod>.js` (same shape both modes —
the bridge masks the difference, importers never change):

```js
// auto-generated from src/lib/crypto/hash.v — do not edit
import { __swelteWasmCall } from '@swelte/core';
const wasmUrl = "/@swelte-dev/crypto/hash.wasm"; // dev — prod: "/assets/app_lib.wasm"
const hash_string_params = [{"name":"input","kind":"string","vtype":"string"}];
export function hash_string(args) {
  return __swelteWasmCall(wasmUrl, 'main.hash_string', args, hash_string_params, "string");
}
```

| mode | WASM output | why |
|---|---|---|
| `swelte dev` | per-file micro-module (`.swelte/dev/<mod>.wasm`, mtime-guarded; served at `/@swelte-dev/<mod>.wasm` as `application/wasm`) | HMR: editing `crypto/hash.v` recompiles only that file (~40ms), the watcher invalidates the stub, Vite swaps the module, rest of the app untouched; untouched utils stay cached |
| `swelte build` | single bundle (`dist/assets/app_lib-<hash>.wasm` via `generateBundle`, exactly one `*.wasm` in `dist/assets/`) — only client-imported `#lib/` files (recorded in `resolveId`; untouched helpers excluded) | one runtime/memory overhead; one `instantiateStreaming()` on cold start (4.2KB for `hash_string`, target <100KB) |

`__swelteWasmCall(url, fn, args, params, retKind)` (internal, in
`sdk.ts`) drives `memory` + `main.<fn>` directly — no JS glue, no
JSON: numerics are i32 params/returns, strings marshal as `{data
ptr, len i32}` structs (params: ONE i32 pointer to the struct;
returns: caller-allocated hidden out-pointer passed FIRST). A wasm
trap rejects with `SwelteRpcError(status 0)`. Same class as server
errors, one `catch` handles either.
Prod dispatch: the consolidated bundle exposes `main.<fn>` per fn
(duplicate fn names across `#lib/` are build errors — one wasm
namespace); per-file stubs resolve their call into it (same
`__swelteWasmCall` signature — dev per-file URL vs prod bundle URL
+ fn name).

* v1 boundary: flat string/int/bool params and string/int/bool/void
  returns only. Struct/array/map/i64/f64 params, non-void fallible
  returns (`?T`/`!T` — wasm backend ICE), and blocked imports are
  build errors with file+line. Known V 0.5.2 backend gaps
  (`strings`/`math` array-`.len` lowering, `crypto/*` transitive
  `io`, C-backed `json`) are build errors too.
* `#lib/backend/` is exempt (never compiled to WASM).

### Shared machinery

```ts
resolveId(id, importer) {
  if (id.endsWith('.v')) return '\0swelte:' + resolve(importer, id);
}
load(id) {
  if (!id.startsWith('\0swelte:')) return null;
  const file = realpath(id);
  if (file.includes('/src/lib/')) return jsWasmFor(parseVFile(src));
  if (file.includes('/src/routes/'))
    return jsFetchFor(parseVFile(src), routeFor(file));
  // warn: .v outside both dirs — ignored (never routed, never typed)
}
```

Plus: `.swelte/v-shim.d.ts` (one `declare module '#routes/x.v'` /
`'#lib/y.v'` per known file, type bodies inlined — no relative
re-export, TS2686), `config()` aliases
`{ #routes -> src/routes, #lib -> src/lib }`, `.swelte/types/**`
projection (`time.Time->number` (unix epoch, decided 2026-10-29), `!T` strips + fallible,
unknown -> `unknown` + warning; `time`/`os`-only types in `#lib/`
warn louder). User tsconfig holds the STABLE wildcards (written once):
`#routes/*.v -> ./.swelte/types/routes/*.d.ts`,
`#lib/*.v -> ./.swelte/types/lib/*.d.ts` (TS drops non-`*` exact keys
from extended configs, so no generated fragment — wildcards only).

`generate()` runs on `configResolved` + `buildStart`, re-runs on
`.v` add/change/unlink. All warnings carry file+line.

## 5. Server side (V dispatcher) — built (2026-10-29)

Only `#routes/` participates. `generate()` emits `routes/`
(`module routes`: one file per routes file + `server_gen.v` with
`SwelteRequest` + `swelte_route`), shared with `server.v` (`Hand` +
static + `main()`) via directory-mode `v run .` (`/` ->
`src/routes/index.v`, `/api/greet` -> `src/routes/api/greet.v`,
else 404; unknown fn -> 404 + available; missing carrier -> 400;
bad JSON -> 400; `!T` -> 400; mismatch -> 405).
Envelope: `../errors.md`. Dev proxy: `../errors.md` SPA-first rule.
See roadmap item 1 (built) and item 23 (static-vlib deferral).

## 6. Decisions (2026-10-29, all built or recorded)

* `time.Time` wire format: unix int (`json.encode(time)` as-is, zero V-side work), TS projects `number` (epoch seconds). No drift: wire and projection agree. `../types.md` updated.
* Notation follows current SvelteKit: `#lib` (hash), not `$lib`.
  SvelteKit swapped `$lib` -> `#lib` (Node subpath-import style);
  we match. Same for `#routes`.
* Keep the `#lib/backend` convention: any `.v` under `src/lib/backend/`
  (at any depth: `src/lib/**/backend/*.v`), or any `*_backend.v` file, is **backend-only**. The
  plugin refuses to resolve it from client code (Svelte components,
  `#lib/` WASM wrappers) with a build error naming importer+file.
  Backend-only `.v` may be imported by `#routes/*.v` (V-to-V include
  at codegen time) but never ships fetch/WASM stubs to the browser.
  Use for secrets, db handles, admin fns.
* Handler shapes (built): verb handlers take the framework
  `SwelteRequest` (query, form, headers, cookies, method, path,
  qualifier; route params open) and return a response; `@[rpc]` fns
  take one args-struct and return `T`/`!T`. TS stubs stay uniform
  (`fn(args)` → `Promise`); the file path already said which kind.
* V runtime placement (deferred — roadmap item 23): `SwelteRequest` +
  `swelte_err_*` stay emitted into `routes/server_gen.v` until the
  shape freezes (route params §8 open). Then: static
  `engine/core/vlib/request.v` (`module routes`), copied verbatim by
  `generate()`, content-hashed. Never `-I node_modules/@swelte/...`
  (pnpm/vendored fragility); import-from-npm is TS-side only.
