# Example: something

Lives at `examples/something/`. Canonical demo of `.v` imports:
`#routes/` server RPC + `#lib/` isomorphic WASM + structured errors.

## Layout

```
src/routes/index.svelte + index.v   / (get_greeting GET, save_name POST)
src/routes/api/greet.v              /api/greet (get_greeting GET, login @[rpc] → Session)
src/lib/crypto/hash.v               isomorphic (hash_string @[rpc] → WASM/dev fallback)
server.v                            hand-written V dispatcher (to be generated)
vite.config.ts                     swelte({ vBackendUrl, routesDir, libDir })
```

## Run

```sh
PORT=8131 v run server.v        # V backend :8131
npx vite --port 5174            # frontend :5174 → open it, not :8131
```

## Proved

- `/` GET/POST (`get_greeting`/`save_name`), `/api/greet` GET + `login → Session{id,user,remember,expires_at}`,
  empty payload → 400, unknown fn → 404 + available, `vite build` green.
- Page buttons: Greet / Save / Hash (`#lib` dev fallback) / Login.
- `hash_string` returns `'hash(x)'` dev placeholder until `v -b wasm` lands.

## Stubs (see docs/specs/)

`server.v` hand-dispatched (to be generated), no `swelte dev`
orchestration, WASM artifact not compiled yet (dev fallback).
