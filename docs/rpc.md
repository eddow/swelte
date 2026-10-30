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
  spelling of `+page.v`, same URL).
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
| `#routes/` | `@[post]` / `@[post('q')]` | POST form (multipart / urlencoded) | form fields = args; default, or `?q` present |
| `#routes/` | `@[put]`/`@[delete]`/`@[patch]` (+`('q')`) | respective method | same per-method rules |
| `#routes/` | `@[before]` / `@[after]` (only in `+route.v`) | — (subtree middleware, roadmap §7) | `@[before]`: root→leaf, `SwelteRequest -> !SwelteRequest`; `@[after]`: leaf→root, response observe-or-replace; middleware fns never exported to TS, but the wrapper's `pub struct`s are (+layout-shaped shared types) |
| `#lib/` | `@[rpc]` | local WASM call | none (direct dispatch) |

- No attribute = internal helper, never exported, never routed.
- Verbs stack across methods (`@[get; post]`), one default per verb
  per file (two `@[post]` defaults = build error); qualifiers unique
  per verb per file. `@[rpc]` unaffected (many per file, always).
- `@[get]`/`@[post]` in `#lib/` warn and still expose as RPC.
- `@[before]`/`@[after]` only in `+route.v` wrappers (roadmap §7):
  subtree middleware, never exported as callables to TS (but the
  wrapper's `pub struct`s are — +layout-shaped shared types).
  `+route.v` files declare no `@[rpc]`/verb endpoints of their own.

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
`{...}`. Verb handlers take the framework `Request` (query, form
fields, headers, cookies, route params — exact shape with the
dispatcher, roadmap item 1).
`!T` = may reject with `SwelteRpcError` (status 0 for local `#lib/`
calls). `?T` = `T | null`.

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
