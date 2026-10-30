# Example: something

Lives at `examples/something/`. Canonical demo of `.v` imports:
`#routes/` server RPC + `#lib/` isomorphic WASM + structured errors.
Built with `swelte build`, served with `swelte preview` (single
artifact: `dist/server` + `dist/`).

## Layout

```
src/routes/index.svelte + index.v   / (get_greeting GET, save_name POST)
src/routes/api/greet.v              /api/greet (get_greeting GET, login @[rpc] → Session)
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
- Page buttons: Greet / Save / Hash (`#lib` real WASM) / Login.
- `hash_string` compiles to real WASM (`v -b wasm -os browser`):
  dev `.swelte/dev/crypto/hash.wasm` + prod `dist/assets/app_lib-*.wasm`.
- Generated dispatcher proven: `routes/index.v` + `routes/api_greet.v` +
  `routes/server_gen.v` (`module routes`, `SwelteRequest` + `swelte_route`),
  one-default-per-verb + unique-qualifier enforced at generate time.
  Error matrix: unknown fn → 404 + available, bad JSON → 400,
  missing fn → 400, `!T` → 400 `err.msg()`, unknown path → 404,
  method without handler → 405.

## Stubs (see docs/specs/)

Dev `/@swelte-dev/<mod>.wasm` micro-modules; prod single bundle
(`__swelteWasmCall` drives `memory` + `main.<fn>` directly).
