# Swelte

V + Svelte full-stack framework. V is the compute engine (native server binary, WASM client modules). Svelte 5 is the UI. One RPC protocol bridges them.

Added a V in Svelte: Built for agents work in, optimized code out.

**Core stack:** V (vlang) + Svelte 5 + WebAssembly + Vite.

- `src/routes/` — server RPC (`.v` = route handler, `#routes/...` import → fetch)
- `src/lib/` — isomorphic lib (`.v` = local compute, `#lib/...` import → WASM call; `backend/` subdirs (or `*_backend.v`) are backend-only)
- `.swelte/` — generated: `types/routes|lib/**` projected from V signatures + `generated/` runtime stubs + `v-shim.d.ts`

```text
browser (:5174 dev) ── routes/HMR (Vite) ───┐
     │  POST / { fn, args }                 │  proxy
     │  GET /?payload=…  Accept: json       ├─► V backend (:8131)
     └── POST /api/*  GET /api/*?payload=… ─┘  (#lib/* never leaves the browser)
prod: browser ──► V :PORT ── static dist/ + same API routes
```

## Quickstart

Requires: Node 20+.

```sh
npx swelte init myapp && cd myapp
npm install
npx swelte dev    # Vite :5174 + V backend :8131, one command
# open http://localhost:5174
```

`swelte dev` resolves V itself (system `v`, else `@swelte/vvm`
toolchain — no manual install). `swelte build` typechecks, compiles
`dist/server`, runs `vite build`, smoke-probes page + API.
`swelte preview` serves the build with no Vite involved.

`examples/something` demonstrates: `#routes/` GET/POST + `@[rpc]`, `#lib/` WASM call (dev fallback), V struct (`Session`), structured errors.

## Docs

- `docs/rpc.md` — `.v` imports, attributes, transport (implemented)
- `docs/types.md` — V → TS projection, codegen (implemented)
- `docs/errors.md` — error envelope, `SwelteRpcError`, SPA-first rule (implemented)
- `docs/example.md` — the `something` example (implemented)
- `docs/versus.md` — Swelte vs. other full-stack paradigms (positioning)
- `docs/specs/` — everything not yet built (`v-imports.md` design, dispatcher, dev orchestration, WASM compile, streaming)
