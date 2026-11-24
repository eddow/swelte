---
name: swelte-v-routes
description: Write Swelte V backend route handlers — @[rpc]/@[get]/@[post]/@[sse]/@[ws]/@[load]/@[before]/@[after] attributes, SwelteRequest shape, V-to-TS types. Use when creating or fixing .v route files, RPC endpoints, forms, or uploads.
---

# Swelte V Routes

Every `.v` file is an ES module. Every `pub fn` with an attribute is a named export. No attribute = internal helper, never exported.

## Attributes

| file | attribute | HTTP | routing |
|---|---|---|---|
| `#routes/` | `@[rpc]` | POST JSON `Accept: application/json` | body `{ "fn", "args" }`; unlimited per file |
| `#routes/` | `@[get]` / `@[get('q')]` | GET `Accept: application/json` | query = args; default, or `?q` present |
| `#routes/` | `@[sse]` / `@[sse('q')]` | GET `Accept: text/event-stream` | three shapes (below); same default/qualifier rules as verbs; room mode rides the Plus `rooms`-plugin hub (`swelte({ plugins: [roomsPlugin] })`) |
| `#routes/` | `@[ws]` (Plus `rooms` plugin) | GET + `Upgrade: websocket` | one socket per file, no qualifier, never stacked; `(req, sub, recv, emit)` → void; TS stub is a URL builder (browser opens native `WebSocket`) |
| `#routes/` | `@[post]` / `@[put]` / `@[delete]` / `@[patch]` (+`('q')`) | respective method | form fields = args; default, or `?q` qualifier |
| `#routes/` leaf + `+route.v` | `@[load]` | page data for HTML, navigation and refresh | `(SwelteRequest[, parent T]) -> !R`; zero/one per file, never stacked, no qualifier |
| `+route.v` only | `@[before]` / `@[after]` | subtree middleware; root `+route.v` = global head | `SwelteRequest -> !SwelteRequest` / observe-or-replace response; never exported to TS |
| `#lib/` | `@[rpc]` | local WASM call | none (direct dispatch) |
| `src/matchers.v` | `@[matcher]` | param matcher, both sides | `(s string) bool`, non-fallible, portable subset only; `integer` builtin |
| `src/app.v` | `@[startup]` | once before `veb.run` | `() void|!void`, zero/one fn, no qualifier, no params; throw aborts boot |
| `src/app.v` | `@[shutdown]` | once after tracked work drains | `() void|!void`; bounded by `SWELTE_SHUTDOWN_TIMEOUT_MS`; startup failure skips it |
| `src/app.v` | `@[report]` | private server telemetry | `(event SwelteReport) void|!void`; original native causes, generated request IDs; callback failure cannot replace responses |
| `src/app.v` | `@[reroute]` | host/path rewrite pre-dispatch | `(host string, path string) string`, `''` = no-op; zero/one fn, no qualifier |

Rules: verbs stack (`@[get; post]`), one default per verb per file, qualifiers unique per verb per file. Never stack `@[sse]`/`@[ws]` with a verb/rpc/sse/ws on one fn (one transport per fn). `@[ws]` never stacks and takes no qualifier (one socket per file). `@[load]` never stacked, no qualifier. Dynamic segments: `[id]` any segment, `[id=matcher]` constrained (`integer` builtin = digits, `Params: number`; custom `@[matcher]` fns in `src/matchers.v`, `Params: string`), `[[slug]]` last-segment optional, `[...rest]` catch-all last. `src/matchers.v` / `src/app.v` are never routed and never importable from browser code; `@[matcher]`/`@[startup]`/`@[shutdown]`/`@[report]`/`@[reroute]` in `src/routes/*` is a build error.

## Handler shapes

Before hooks run before page loads, mutations and SSE/WS takeover; their locals
reach the handler. After hooks preserve metadata/cookies on those paths.
Use `return swelte_redirect_error('/login', 303)` from fallible middleware for
redirects. `swelte.compat: 'sveltekit'` selects named `?/save` actions;
legacy qualifiers remain the default. PostgreSQL is an ordinary native V
dependency (`db.pg`), not a missing Swelte ORM.

For native byte streaming, return `swelte_stream(headers, fn (s SwelteStream) ! { ... })`
from a verb handler. `s.write(bytes)` returns false when disconnected or a
chunk exceeds the configured limit; select on `s.cancelled` while idle and
release app-owned resources on return. Bytes are sent unchanged, including
application-owned SSE framing. The buffer is bounded; idle/write timeout and
chunk limit use `SWELTE_STREAM_IDLE_MS` and `SWELTE_STREAM_CHUNK_LIMIT`.

```v
module greet

pub struct LoginArgs {
pub:
	payload string
}

pub struct Session {
pub:
	id         string
	user       string
	remember   bool
	expires_at time.Time // projects to number (unix epoch), same on the wire
}

@[rpc]
pub fn login(args LoginArgs) !Session {
	if args.payload == '' {
		return error('missing payload') // -> 400 {"error":"missing payload"}
	}
	return Session{ id: 'sess_' + args.payload user: args.payload remember: true expires_at: time.now() }
}

@[get]
pub fn get_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { '""' }
	return 'Hello, ' + name.trim('"') + '!'
}

@[post('delete')]
pub fn delete_account(req SwelteRequest) !string {
	return 'deleted'
}
```

- `@[rpc]` fns take exactly one args-struct; TS receives it inline (`Parameters<typeof login>[0]`).
- Verb handlers take `SwelteRequest{query, form, files, headers, cookies, params, method, path, locals}` or narrow params (`(name string, age int)` → inline literal, numbers coerced server-side).
- `!T` = may reject with `SwelteRpcError`. `?T` = `T | null`.
- `Request.params` carries dynamic segments (`req.params['id]` for `/users/[id]`); client stubs interpolate them into the URL.
- `files: Record<string,string>` holds uploaded **filenames** only — bytes are parsed then discarded (never persisted, never projected).
- `@[sse]` list mode returns `[]string` (harness streams each); emit mode takes trailing `emit fn (string) bool` + returns void — each `emit(e)` flushes one frame NOW (`if !emit(e) { return }` on disconnect). Room mode (Plus `rooms` plugin) takes trailing `sub fn (string) chan string` + `emit fn (string) bool` — harness injects a room-subscribe closure; `backend.emit(room, msg)` fans out cross-request. TS stub is `AsyncGenerator<string>` in all shapes.
- `@[ws]` (Plus `rooms` plugin) takes `(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool)` + returns void — hub messages stream out via `emit`, client frames stream back via `recv`. TS stub is a URL builder (`__swelteWsUrl`) — the browser opens a native `WebSocket` itself.

For channels on bundled V 0.5.2, bind array payloads before sending inside
`select` (`packet := [event]`, then `ch <- packet`); array literals there can
send an empty array. A `select` with `else` does not reliably observe closed
receives. Use an explicit buffered completion notification when polling.
Stream callbacks should capture owned heap resources rather than request
contexts whose lifetime ends at takeover. See `openspec/specs/native-lifecycle/reference.md` for drain,
resource ownership, private reporting and room cleanup.

## Type table (V → TS)

`string→string`, `bool→boolean`, ints/floats→`number`, `[]T→T[]`, `[]u8→string` (base64), `map[string]T→Record<string,unknown>` (value opaque), `time.Time→number`, `?T→T|null`, `!T` strips to `T` + fallible. Named `UpperCamel` structs pass 1:1, else `unknown` + warning.

## Errors

Unknown `@[rpc]` fn → 404 + `available` fns. Missing `"fn"` → 400. Bad JSON → 400. `!T` failure → 400 `err.msg()`. Unknown `?q` → 404 + available qualifiers. Method without handler → 405. Unknown path → 404. Over `SWELTE_BODY_LIMIT` (default 10MB) → 413. Over rate limit → 429. Handler over `SWELTE_HANDLER_TIMEOUT_MS` (default 10s) → 500, server stays up. No-JS navigations (`Accept: text/html` POST): success → `303` + `Location`, failure → rendered HTML error, same status.

## Hard constraints

- `#lib/` code compiles to WASM: pure synchronous logic only. No `fetch`, no `async`, no sockets/fs in isomorphic `#lib/` files. Backend-only code goes in `backend/` subdirs or `*_backend.v` (build error from browser code).
- `+route.v` declares no `@[rpc]`/verb endpoints of its own.
- Folder-root double-claim (`foo.v` + `foo/+page.v`, either extension) is a build error.
- Uc-first `.svelte` stems are components, never routes (`Streamed.svelte` is
  importable, claims no URL — mirrors Svelte's component/element case rule).
  Lowercase stays routable (`about.svelte` ⇔ `about/+page.svelte`).

## Sources

Stable — no spec dependency:

- `openspec/specs/rpc/reference.md` — imports, attributes, transport (source of truth)
- `openspec/specs/type-projection/reference.md` — V → TS projection, codegen
- `openspec/specs/errors/reference.md` — error envelope, SPA-first rule
- `openspec/specs/forms/reference.md` — verbs + `?q` no-JS 303, `fail`-lite, `deserialize`, `use:enhance` / `applyAction` cycle
- `openspec/specs/configuration/reference.md` — routing knobs, `src/app.v` lifecycle, `+route.svelte` nesting, per-route types, `#app/*`, locals/cookies, `HEAD`/`OPTIONS`, no-JS, per-route `ssr=false`-lite (`export const ssr = false` → `Hand` skips rendering, serves SPA shell)
