# Swelte

[![npm version](https://img.shields.io/npm/v/@swelte/core.svg)](https://www.npmjs.com/package/@swelte/core)
[![npm downloads](https://img.shields.io/npm/dm/@swelte/core.svg)](https://www.npmjs.com/package/@swelte/core)

V + Svelte full-stack framework. V is the compute engine (native server binary, WASM client modules). Svelte 5 is the UI. One RPC protocol bridges them.

Added a V in Svelte: Built for agents work in, optimized code out.

**Core stack:** V (vlang) + Svelte 5 + WebAssembly + Vite.

## Packages

Published on npm under the [`@swelte` scope](https://www.npmjs.com/org/swelte):

| Package | npm | Description |
|---|---|---|
| `@swelte/core` | [![npm version](https://img.shields.io/npm/v/@swelte/core.svg)](https://www.npmjs.com/package/@swelte/core) | Framework core — V + Svelte RPC bridge (Vite plugin, SDK generator, CLI: `swelte`) |
| `@swelte/ssr-qjs` | [![npm version](https://img.shields.io/npm/v/@swelte/ssr-qjs.svg)](https://www.npmjs.com/package/@swelte/ssr-qjs) | SSR adapter — embedded QuickJS engine (default) |
| `@swelte/mcp` | [![npm version](https://img.shields.io/npm/v/@swelte/mcp.svg)](https://www.npmjs.com/package/@swelte/mcp) | MCP server — route tree, type contracts, diagnostics for IDE agents (`swelte-mcp`) |
| `@swelte/vvm` | [![npm version](https://img.shields.io/npm/v/@swelte/vvm.svg)](https://www.npmjs.com/package/@swelte/vvm) | V Version Manager — installs and manages V toolchains (`vvm`, `v` shim) |
| `@swelte/plus` | [![npm version](https://img.shields.io/npm/v/@swelte/plus.svg)](https://www.npmjs.com/package/@swelte/plus) | Beyond-SvelteKit plugins — scheduled jobs (`@[cron]` ticks: retry, dead-letter, tick log) |

```sh
npm install @swelte/core
# SSR (default engine), MCP server, V toolchain, plus plugins come along as needed:
npm install @swelte/ssr-qjs @swelte/mcp @swelte/vvm @swelte/plus
```

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
npx @swelte/core init myapp && cd myapp
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

> 📚 [Documentation](https://swelte.emedware.dev/)

Built behavior, user-facing only:

- [SSR](https://github.com/eddow/swelte/blob/main/docs/ssr.md) — ownership, request path, `@[load]`
  cascade, `+error` contract, measured budgets, gate
- [RPC](https://github.com/eddow/swelte/blob/main/docs/rpc.md) — `.v` imports, attributes, transport
- [Types](https://github.com/eddow/swelte/blob/main/docs/types.md) — V → TS projection, codegen
- [Errors](https://github.com/eddow/swelte/blob/main/docs/errors.md) — error envelope, `SwelteRpcError`, SPA-first rule
- [Config](https://github.com/eddow/swelte/blob/main/docs/config.md) — `svelte.config.js` (`swelte` key) + `SWELTE_*` env knobs, routing, per-route types
- [Forms](https://github.com/eddow/swelte/blob/main/docs/forms.md) — verbs + `?q`, no-JS 303, `fail`-lite, `deserialize`
- [CLI](https://github.com/eddow/swelte/blob/main/docs/cli.md) — `dev`/`build`/`preview`/`test`/`check`/`init`
- [Example](https://github.com/eddow/swelte/blob/main/docs/example.md) — the `something` example
- [Versus](https://github.com/eddow/swelte/blob/main/docs/versus.md) — Swelte vs. other full-stack paradigms (positioning)
- [Coming from SvelteKit](https://github.com/eddow/swelte/blob/main/docs/coming-from-sveltekit.md) — migration map
- [Plus](https://github.com/eddow/swelte/blob/main/docs/plus.md) — `@swelte/plus` beyond-SvelteKit plugins: scheduled jobs (`@[cron]` ticks, retry, console log)