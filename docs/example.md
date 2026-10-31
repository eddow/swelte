# Example: something

Lives at `examples/something/`. Canonical demo of `.v` imports:
`#routes/` server RPC + `#lib/` isomorphic WASM + structured errors.
Built with `swelte build`, served with `swelte preview` (single
artifact: `dist/server` + `dist/`).

## Layout

```
src/routes/+page.svelte + +page.v   / (get_greeting GET, save_name POST)
src/routes/api/greet.v              /api/greet (get_greeting GET, login @[rpc] → Session)
src/routes/users/[id].v             /users/[id] ([id] → req.params['id], roadmap §8)
src/routes/files/[...rest].v        /files/[...rest] (catch-all → req.params['rest'])
src/routes/admin/+route.svelte + +route.v   /admin wrapper (nav + @[before] sess guard / @[after] passthrough)
src/routes/admin/+page.svelte + +page.v     /admin leaf (admin_whoami GET, reads injected x-user)
src/lib/crypto/hash.v               isomorphic (hash_string @[rpc] → WASM/dev fallback)
server.v                            Hand + static + main() — calls generated routes/swelte_route
routes/                             generated V dispatcher (regenerating, gitignored)
vite.config.ts                     swelte({ vBackendUrl, routesDir, libDir })
```

## Run

```sh
node engine/core/dist/cli.js dev --port 5174 --backend 8131 --root examples/something
# one command: V backend :8131 + Vite :5174, HMR reload on .v change, Ctrl-C kills both
# manual two-terminal equivalent:
#   PORT=8131 v run .              # V backend :8131 (server.v + generated routes/)
#   npx vite --port 5174           # frontend :5174 → open it, not :8131
```

## Proved

- `/` GET/POST (`get_greeting`/`save_name`), `/api/greet` GET + `login → Session{id,user,remember,expires_at}`,
  empty payload → 400, unknown fn → 404 + available, `vite build` green.
- Page buttons: Greet / Save / Hash (`#lib` real WASM) / Login / Stream (`@[sse]` `tick_stream`).
- SSE proven (true streaming via veb, emit mode): `Accept: text/event-stream` on `/api/greet` → 200 with per-event flush (`data: tick 1` ~0.5s, `tick 2` ~1.0s, `tick 3` ~1.5s with `?wait_ms=500` — pacing proves zero buffering); plain JSON GETs keep hitting `@[get]` on the same URL.
- `hash_string` compiles to real WASM (`v -b wasm -os browser`):
  dev `.swelte/dev/crypto/hash.wasm` + prod `dist/assets/app_lib-*.wasm`.
- Generated dispatcher proven: `routes/_page.v` + `routes/api_greet.v` +
  `routes/admin__page.v` + `routes/server_gen.v` (`module routes`,
  `SwelteRequest` + `swelte_route`), one-default-per-verb +
  unique-qualifier enforced at generate time.
- Dynamic segments proven: `/users/42` → `"user:42"`, `/users/` + `/users` →
  404, `/files/a/b/c` → `"files:a/b/c"` (`req.params`; static beats
  dynamic, `[...rest]` last).
- Uploads proven: multipart `POST /api/greet?upload` reads `req.files['file']` (fallible `!string`) → `"got:<name>"`; only filenames kept (bytes parsed then discarded, never persisted); JS stubs send `File`/`Blob` args as `FormData`; 5MB under the 10MB `SWELTE_BODY_LIMIT` cap → 200; over-cap body → 413.
- No-JS proven: `Accept: text/html` POST → 303 + `Location` on success, rendered HTML error on failure; `Accept: application/json` keeps JSON (same handler, content-negotiated). Page has plain `<form method=post>` variants (save + upload).
- Middleware chain proven: `admin/+route.v` `@[before]` rejects without
  `sess` cookie (400 `missing session`), injects `x-user` otherwise;
  `@[after]` passes through; `/` + `/api/greet` unaffected (scoping).
  Folder-root double-claim (`foo.v` + `foo/+page.v`, or `foo.svelte` +
  `foo/+page.svelte`, either extension on either side) is a build error.
  Error matrix: unknown fn → 404 + available, bad JSON → 400,
  missing fn → 400, `!T` → 400 `err.msg()`, unknown path → 404,
  method without handler → 405.

## Stubs (see `rpc.md`, `types.md`)

Dev `/@swelte-dev/<mod>.wasm` micro-modules; prod single bundle
(`__swelteWasmCall` drives `memory` + `main.<fn>` directly).
