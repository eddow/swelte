---
name: swelte-v-routes
description: Write Swelte V backend route handlers — @[rpc]/@[get]/@[post]/@[sse]/@[load]/@[before]/@[after] attributes, SwelteRequest shape, V-to-TS types. Use when creating or fixing .v route files, RPC endpoints, forms, or uploads.
---

# Swelte V Routes

Every `.v` file is an ES module. Every `pub fn` with an attribute is a named export. No attribute = internal helper, never exported.

## Attributes

| file | attribute | HTTP | routing |
|---|---|---|---|
| `#routes/` | `@[rpc]` | POST JSON `Accept: application/json` | body `{ "fn", "args" }`; unlimited per file |
| `#routes/` | `@[get]` / `@[get('q')]` | GET `Accept: application/json` | query = args; default, or `?q` present |
| `#routes/` | `@[sse]` / `@[sse('q')]` | GET `Accept: text/event-stream` | two shapes (below); same default/qualifier rules as verbs |
| `#routes/` | `@[post]` / `@[put]` / `@[delete]` / `@[patch]` (+`('q')`) | respective method | form fields = args; default, or `?q` qualifier |
| `#routes/` leaf + `+route.v` | `@[load]` | page data, `Hand` HTML navigations only | `(SwelteRequest[, parent T]) -> !R`; zero/one per file, never stacked, no qualifier |
| `+route.v` only | `@[before]` / `@[after]` | subtree middleware; root `+route.v` = global head | `SwelteRequest -> !SwelteRequest` / observe-or-replace response; never exported to TS |
| `#lib/` | `@[rpc]` | local WASM call | none (direct dispatch) |
| `src/matchers.v` | `@[matcher]` | param matcher, both sides | `(s string) bool`, non-fallible, portable subset only; `integer` builtin |
| `src/app.v` | `@[startup]` | once before `veb.run` | `() void|!void`, zero/one fn, no qualifier, no params; throw aborts boot |
| `src/app.v` | `@[reroute]` | host/path rewrite pre-dispatch | `(host string, path string) string`, `''` = no-op; zero/one fn, no qualifier |
| `src/app.v` (open) | `@[cron]` / `@[queue]` | duration loop / in-process channel | `specs/moar.md` — not built yet; misplaced use in `src/routes/*` will be a build error |

Rules: verbs stack (`@[get; post]`), one default per verb per file, qualifiers unique per verb per file. Never stack `@[sse]` with a verb/rpc on one fn. `@[load]` never stacked, no qualifier. Dynamic segments: `[id]` any segment, `[id=matcher]` constrained (`integer` builtin = digits, `Params: number`; custom `@[matcher]` fns in `src/matchers.v`, `Params: string`), `[[slug]]` last-segment optional, `[...rest]` catch-all last. `src/matchers.v` / `src/app.v` are never routed and never importable from browser code; `@[matcher]`/`@[startup]`/`@[reroute]` in `src/routes/*` is a build error.

## Handler shapes

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
- `@[sse]` list mode returns `[]string` (harness streams each); emit mode takes trailing `emit fn (string) bool` + returns void — each `emit(e)` flushes one frame NOW (`if !emit(e) { return }` on disconnect). TS stub is `AsyncGenerator<string>`.

## Type table (V → TS)

`string→string`, `bool→boolean`, ints/floats→`number`, `[]T→T[]`, `[]u8→string` (base64), `map[string]T→Record<string,unknown>` (value opaque), `time.Time→number`, `?T→T|null`, `!T` strips to `T` + fallible. Named `UpperCamel` structs pass 1:1, else `unknown` + warning.

## Errors

Unknown `@[rpc]` fn → 404 + `available` fns. Missing `"fn"` → 400. Bad JSON → 400. `!T` failure → 400 `err.msg()`. Unknown `?q` → 404 + available qualifiers. Method without handler → 405. Unknown path → 404. Over `SWELTE_BODY_LIMIT` (default 10MB) → 413. Over rate limit → 429. Handler over `SWELTE_HANDLER_TIMEOUT_MS` (default 10s) → 500, server stays up. No-JS navigations (`Accept: text/html` POST): success → `303` + `Location`, failure → rendered HTML error, same status.

## Hard constraints

- `#lib/` code compiles to WASM: pure synchronous logic only. No `fetch`, no `async`, no sockets/fs in isomorphic `#lib/` files. Backend-only code goes in `backend/` subdirs or `*_backend.v` (build error from browser code).
- `+route.v` declares no `@[rpc]`/verb endpoints of its own.
- Folder-root double-claim (`foo.v` + `foo/+page.v`, either extension) is a build error.

## Sources

Stable — no spec dependency for the above:

- `docs/rpc.md` — imports, attributes, transport (source of truth)
- `docs/types.md` — V → TS projection, codegen
- `docs/errors.md` — error envelope, SPA-first rule
- `docs/forms.md` — verbs + `?q` no-JS 303, `fail`-lite, `deserialize`, `use:enhance` / `applyAction` cycle
- `docs/config.md` — routing knobs, `src/app.v` lifecycle, `+route.svelte` nesting, per-route types, `#app/*`, locals/cookies, `HEAD`/`OPTIONS`, no-JS

## Spec dependency

⚠️ This skill MUST be updated when these specs land:

- `docs/specs/moar.md` — `@[cron]` (duration spawn loop) and `@[queue]`
  (in-process channel). Same file/shape conventions as the built hooks
  in `src/app.v`.
- `docs/config.md` — per-route `ssr=false`-lite (manifest flag →
  `Hand` skips rendering, serves SPA shell).
