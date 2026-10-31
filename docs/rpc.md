# RPC: `.v` imports, attributes, transport

Source of truth for how Svelte calls V. No `self`, no `$ssapi`, no
`$csapi` — every `.v` file is an ES module, every `pub fn` with an
attribute is a named export.

Generated V dispatcher (`routes/`, `module routes`): `generate()` emits
one file per routes file (routes/+page.v`, `routes/api_greet.v`) plus
`routes/server_gen.v` (`SwelteRequest` + `swelte_route` + `err_*`
helpers). `server.v` is `Hand` + static handlers + `main()` only, run
via directory-mode `v run .`. Structs are prefixed per file
(`ApiGreet_LoginArgs`) to share one module; fns are `swelte_<mod>_*`
(snake_case, V requirement).

## Directories

- `src/routes/**/*.v` — server RPC. File path is the route:
  `+page.v` → `/`, `api/greet.v` → `/api/greet` (`index.v` is the legacy
  spelling of `+page.v`, same URL). Dynamic segments: `users/[id].v` →
  `/users/[id]`, `files/[...rest].v` → `/files/[...rest]` (roadmap §8;
  params arrive in `Request.params`).
  Import from `#routes/...` (or relative `./x.v`).
- `src/lib/**/*.v` — isomorphic lib. Never routed, never fetched.
  Same V compiles native + `v -b wasm`; TS import is always `async`.
  Import from `#lib/...`. `src/lib/**/backend/*.v` (or `*_backend.v`) is **backend-only**
  (build error from browser code).

## Imports (named everywhere)

Every `.v` file is an ES module. Every `pub fn` with an attribute is a named
export. No attribute = internal, never exported.

```svelte
<script lang="ts">
  import { get_greeting, save_name } from '#routes/+page.v';
  import { login } from '#routes/api/greet.v';
  import { hash_string } from '#lib/crypto/hash.v';
</script>
```

Directory decides runtime: `#routes/` = server fetch, `#lib/` =
local WASM call. Extension stays `.v` in both.

`#routes/...` and `#lib/...` map 1:1 by file path (with extension).
Relative `./x.v` works from any importer inside the same dir.

## Attributes

Each verb attribute IS the HTTP verb. One default fn per verb per file.
`@[rpc]` fns are the only named functions: many per file, `fn` in the
JSON body. No `?fn=` anywhere (removed with the old model).

| file | attribute | HTTP | routing |
|---|---|---|---|
| `#routes/` | `@[rpc]` | POST JSON `Accept: application/json` | body `{ "fn", "args" }`; unlimited per file |
| `#routes/` | `@[get]` / `@[get('q')]` | GET `Accept: application/json` | query = args; default, or `?q` present |
| `#routes/` | `@[sse]` / `@[sse('q')]` | GET `Accept: text/event-stream` (true streaming via veb, roadmap §14) | query = args; default, or `?q` present. Two shapes: list mode returns `[]string` (harness streams each per-event); emit mode takes trailing `emit fn (string) bool` + returns void — each `emit(e)` flushes one frame NOW (`if !emit(e) { return }` on disconnect). Client stub is `AsyncGenerator<string>` (`for await`); `!T` failures + unknown qualifiers stay JSON |
| `#routes/` | `@[post]` / `@[post('q')]` | POST form (multipart / urlencoded) | form fields = args; default, or `?q` present. `File`/`Blob` stub args → multipart, filenames land in `Request.files` (bytes discarded); plain values → urlencoded |
| `#routes/` | `@[put]`/`@[delete]`/`@[patch]` (+`('q')`) | respective method | same per-method rules |
| `#routes/` | `@[before]` / `@[after]` (only in `+route.v`) | — (subtree middleware, roadmap §7) | `@[before]`: root→leaf, `SwelteRequest -> !SwelteRequest`; `@[after]`: leaf→root, response observe-or-replace; middleware fns never exported to TS, but the wrapper's `pub struct`s are (+layout-shaped shared types) |
| `#routes/` leaf + `+route.v` | `@[load]` | — (page data, `Hand` HTML navigations only) | `(SwelteRequest[, parent T]) -> !R`. Zero/one per file. Level 0 takes `(req)`; deeper levels take `(req, parent T)` where T is the previous level's return struct (short or prefixed spelling — mismatch is a build error). The cascade threads typed values root-first; the leaf's return is encoded once at the edge → `props_json` for SSR. No JSON in `.v` files. Throw → `+error` props. On-click stubs stay — `load` is initial paint only |
| `#lib/` | `@[rpc]` | local WASM call | none (direct dispatch) |

- No attribute = internal helper, never exported, never routed.
- Verbs stack across methods (`@[get; post]`), one default per verb
  per file (two `@[post]` defaults = build error); qualifiers unique
  per verb per file. `@[rpc]` unaffected (many per file, always).
  `@[sse]` is GET+Accept-gated and follows the same default/qualifier
  rules as verbs (one `@[sse]` default coexists with `@[get]`); stacking
  `@[sse]` with any verb/rpc on one fn is a build error (one transport
  per fn). `@[sse]` has two shapes: list mode returns `[]string`,
  emit mode takes trailing `emit fn (string) bool` + returns void
  (mutually exclusive — build error otherwise).
- `@[get]`/`@[post]` in `#lib/` warn and still expose as RPC.
- `@[before]`/`@[after]` only in `+route.v` wrappers (roadmap §7):
  subtree middleware, never exported as callables to TS (but the
  wrapper's `pub struct`s are — +layout-shaped shared types).
  `+route.v` files declare no `@[rpc]`/verb endpoints of their own.
- SSR component rule (enforced by `@swelte/ssr-qjs` at build time):
  SDK imports (`#routes/*`, `#lib/*`, `loadPage`) are allowed in `.svelte`
  files — interaction handlers (`onclick`, `onMount`, plain functions) keep
  working after hydration. But a stub *called* at component top level fires
  during SSR render (no fetch in QuickJS) → build error naming the stub.
  Move load-time data into `$props()` (supplied by `@[load]` via `Hand`);
  keep the stub for handlers. Top-level `await` is rejected by the Svelte
  compiler itself (both modes).

```v
module greet
pub struct LoginArgs { pub: payload string }
pub struct Session { pub: id string user string remember bool expires_at time.Time }

@[rpc]
pub fn login(args LoginArgs) !Session { ... }

@[post('delete')]
pub fn delete_account(req Request) ! { ... }
```

`@[rpc]` fns take one args-struct (`pub fn f(args Args)`); TS sends
`{...}` projected inline (`args: { payload: string }`, retrievable via
`Parameters<typeof f>[0]` — the args struct stays V-side, only the
inline literal and the result interface project to TS). Verb handlers
take the framework `Request` (query, form,
files, headers, cookies, route params — exact shape with the
dispatcher, roadmap item 1). `@[sse]` fns take the framework `Request`
like verbs in two shapes: list mode returns `[]string`, emit mode
takes trailing `emit fn (string) bool` + returns void — the harness
injects `emit`, each call flushes one frame NOW. The TS stub is an
`AsyncGenerator<string>` (`for await … of`, roadmap item 14).
`!T` = may reject with `SwelteRpcError` (status 0 for local `#lib/`
calls). `?T` = `T | null`. `Request.params` carries dynamic-segment
values (`req.params['id']` for `/users/[id]`); client stubs
interpolate them into the URL and strip them from the payload.

## Transport

POST JSON → `{ "fn": "<name>", "args": {...} }` to `/` or `/api/<path>`
(`@[rpc]` dispatch by name). POST form → the file's verb handler for
that method (default, or `?q` qualifier: `<form action="?delete">` →
`@[post('delete')]`). Content-Type decides: JSON → `@[rpc]`, form →
verb dispatch. GET with `Accept: application/json` → `@[get]` handler,
query = args:

```
GET /api/greet?payload="world"  Accept: application/json
```

`#lib/`: `postMessage`-free. `import { hash_string } from
'#lib/crypto/hash.v'` runs the WASM module in-process (dev: JS
fallback with a console warning until `v -b wasm` lands).
Same `SwelteRpcError` class, `status: 0`.
