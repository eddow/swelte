# Swelte

V + Svelte full-stack framework. V is the compute engine (native server binary, WASM client modules). Svelte 5 is the UI. One RPC protocol bridges them.

Svelte, but with V: Best stack to have agents work in, optimized code out.

**Core stack:** V (vlang) + Svelte 5 + WebAssembly + Vite.

- `src/routes/` — server RPC (`.v` = route handler, `#routes/...` import → fetch)
- `src/lib/` — isomorphic lib (`.v` = local compute, `#lib/...` import → WASM call; `server/` subdirs are server-only)
- `.swelte/` — generated: `types/routes|lib/**` projected from V signatures + `generated/` runtime stubs + `v-shim.d.ts`

```text
browser (:5174 dev) ── routes/HMR (Vite) ──┐
     │  POST / { fn, args }                │  proxy
     │  GET /?fn=&...  Accept: json        ├─► V backend (:8131)
     └── POST /api/*  GET /api/*?fn= ──────┘  (#lib/* never leaves the browser)
prod: browser ──► V :PORT ── static dist/ + same API routes
```

## Quickstart

Requires: Node 20+, V 0.5.2 via `vvm` (`engine/vvm`).

```sh
npm install
npm run build:engine
# terminal 1: V backend (example)
PORT=8131 ./engine/vvm/versions/v0.5.2/v run examples/something/server.v
# terminal 2: frontend
cd examples/something && npx vite --port 5174
# open http://localhost:5174
```

`examples/something` demonstrates: `#routes/` GET/POST + `@[rpc]`, `#lib/` WASM call (dev fallback), V struct (`Session`), structured errors.

## Docs

- `docs/rpc.md` — `.v` imports, attributes, transport (implemented)
- `docs/types.md` — V → TS projection, codegen (implemented)
- `docs/errors.md` — error envelope, `SwelteRpcError`, SPA-first rule (implemented)
- `docs/example.md` — the `something` example (implemented)
- `docs/specs/` — everything not yet built (`v-imports.md` design, dispatcher, dev orchestration, WASM compile, streaming)
