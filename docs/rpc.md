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
  `/users/[id]`, `files/[...rest].v` → `/files/[...rest]`;
  `[id=integer]` constrains to digits (see `config.md`);
  params arrive in `Request.params`). `[...rest]` may match empty
  (`GET /files` → `rest=''` when no `files/+page.v` leaf claims `/files`;
  when the leaf exists it wins — static beats dynamic). Catch-all is a
  fallback: it matches only when no exact or narrower dynamic arm does.
  `.svelte` and `.v` match independently (HTML vs JSON dispatch never
  conflict — see `internal/v-imports.md` §2).
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
| `#routes/` | `@[rpc]` | POST JSON `Accept: application/json` (or local WASM call in `#lib/`) | body `{ "fn", "args" }`; unlimited per file. **Protocol-ignorant:** typed args-struct in, typed value out (or throw → reject). No HTTP types (`SwelteRequest`/`SwelteResponse`/`[]u8`/`(int,string)` are build errors) |
| `#routes/` | `@[get]` / `@[get('q')]` | GET `Accept: application/json` | query = args; default, or `?q` present |
| `#routes/` | `@[sse]` / `@[sse('q')]` | GET `Accept: text/event-stream` (true streaming via veb) | query = args; default, or `?q` present. Two shapes: list mode returns `[]string` (harness streams each per-event); emit mode takes trailing `emit fn (string) bool` + returns void — each `emit(e)` flushes one frame NOW (`if !emit(e) { return }` on disconnect). Client stub is `AsyncGenerator<string>` (`for await`); `!T` failures + unknown qualifiers stay JSON |
| `#routes/` | `@[post]` / `@[post('q')]` | POST form (multipart / urlencoded) | form fields = args; default, or `?q` present. `File`/`Blob` stub args → multipart, filenames land in `Request.files` (bytes discarded); plain values → urlencoded |
| `#routes/` | `@[put]`/`@[delete]`/`@[patch]` (+`('q')`) | respective method | same per-method rules |
| `#routes/` | `@[before]` / `@[after]` (only in `+route.v`) | — (subtree middleware; root `+route.v` is the global head, chains into every leaf) | `@[before]`: root→leaf, `SwelteRequest -> !SwelteRequest`; `@[after]`: leaf→root, `(SwelteRequest, SwelteResponse) -> !SwelteResponse`; middleware fns never exported to TS, but the wrapper's `pub struct`s are (+layout-shaped shared types) |
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
- `@[before]`/`@[after]` only in `+route.v` wrappers:
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
pub fn greet_pure(args LoginArgs) !Session { ... }

@[post]
pub fn login(req SwelteRequest) !SwelteResponse { ... } // HTTP: sets sess cookie

@[post('delete')]
pub fn delete_account(req SwelteRequest) !SwelteResponse { ... }
```

`@[rpc]` fns are protocol-ignorant typed calls (`pub fn f(args Args) !R`):
one args-struct in, typed value out, throw → TS reject. They never see HTTP
(`SwelteRequest`/`SwelteResponse` params or HTTP returns are build errors —
put those on verbs). `#lib/` `@[rpc]` fns are the same shape, run as local
WASM. TS sends `{...}` projected inline (`args: { payload: string }`, retrievable via
`Parameters<typeof f>[0]` — the args struct stays V-side, only the
inline literal and the result interface project to TS). Verb handlers (HTTP) take the framework `SwelteRequest` (query, form, files (+`files_bytes`/`raw_body`),
headers, cookies, route params — exact shape with the dispatcher) and return a
response: `string`/`struct` (JSON), `[]u8` (binary, `Content-Type` required),
`(int, string)` (status+text sugar), or `SwelteResponse` (full control:
`status`, `headers`, `cookies`, `body`/`body_bytes`). `@[sse]` fns take the framework `Request`
like verbs in two shapes: list mode returns `[]string`, emit mode
takes trailing `emit fn (string) bool` + returns void — the harness
injects `emit`, each call flushes one frame NOW. The TS stub is an
`AsyncGenerator<string>` (`for await … of`).
`!T` = may reject with `SwelteRpcError` (status 0 for local `#lib/`
calls). `?T` = `T | null`. `Request.params` carries dynamic-segment
values (`req.params['id']` for `/users/[id]`); client stubs
interpolate them into the URL and strip them from the payload.

## Request / Response

```v
// Exact shape (emitted into routes/server_gen.v). Hand translates the
// response 1:1 into veb calls (set_status, custom headers, Set-Cookie,
// send_response_to_client). Routes never touch veb — they return data.
pub struct SwelteRequest {
  query map[string]string
  form map[string]string
  files map[string]string          // filenames per field (`;`-joined on multi)
  files_bytes map[string][]u8     // raw bytes per field (multipart parse)
  raw_body []u8                   // raw request bytes (webhook HMAC)
  headers map[string]string
  cookies map[string]string
  params map[string]string
  locals map[string]string
  method string
  path string
  qualifier string
}

pub struct SwelteCookie {
  name string
  value string
  path string
  max_age int
  expires string
  domain string
  secure bool
  http_only bool
  same_site string // Lax | Strict | None
}

pub struct SwelteResponse {
  status int = 200
  headers map[string]string // Content-Type, Content-Disposition, Location, ...
  cookies []SwelteCookie
  body string               // text/JSON already encoded
  body_bytes []u8           // binary path, exclusive with body
  is_bytes bool
}

// Sugar (server_gen.v): swelte_text / swelte_json / swelte_status /
// swelte_bytes(data, content_type) / swelte_redirect(location, status).
// Cookie helpers: swelte_cookie_get(req, name), swelte_cookie_set(mut out,
// name, value), swelte_cookie_set_full(mut out, c), swelte_cookie_delete.
```

Return kinds — verbs (HTTP): `void` → `{}`; `string`/struct → JSON;
`[]u8` → binary (`application/octet-stream` unless the handler sets
`Content-Type`); `(int, string)` → status+text; `SwelteResponse` → full
control (passthrough, incl. `Content-Disposition`, `Set-Cookie`).
`!T` failure → `400 err.msg()` (JSON). `!T` throw is also how `@[rpc]` signals errors (→ TS reject, no HTTP status).
`@[rpc]` return kinds are typed values only (struct/string/number/bool/array/map/`?T`): HTTP shapes (`SwelteResponse`/`[]u8`/`(int,string)`) and HTTP params (`SwelteRequest`) are build errors. Binary responses send raw bytes
with the handler's `Content-Type`; JSON/text send `body` with
`Content-Type` (default `application/json`). TS stubs branch on
`Content-Type`: JSON → `json()`, text → `text()`, else `Blob`.

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
