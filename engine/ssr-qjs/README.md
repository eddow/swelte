# `@swelte/ssr-qjs`

[![npm version](https://img.shields.io/npm/v/@swelte/ssr-qjs.svg)](https://www.npmjs.com/package/@swelte/ssr-qjs)
[![npm downloads](https://img.shields.io/npm/dm/@swelte/ssr-qjs.svg)](https://www.npmjs.com/package/@swelte/ssr-qjs)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/emedware)

> 📚 [Documentation](https://swelte.emedware.dev/)

Swelte SSR adapter — embedded QuickJS engine (the default engine).

Re-exports everything from `@swelte/core` so user code swaps one import:

```ts
import { swelte } from '@swelte/ssr-qjs' // instead of '@swelte/core/vite'
```

Core stays engine-agnostic: this package owns ALL engine deps
(`svelte/compiler` at build time, vendored QuickJS at runtime).
Core never imports `svelte/compiler`, `quickjs`, or a JS runtime.

## Layout

```
src/   compose (ssr.ts) · swelte() wrapper (vite.ts) · QJS link (qjs.ts)
       dev sidecar (dev.ts) · runSsrCheck + ssrPlugin (cli.ts, vite.ts)
shims/ QJS-safe substitutes (2 svelte internals + SDK shim)

The vendored QuickJS engine + shared V module live in `@swelte/qjs`
(`engine/qjs/`): `c/` sources, `swelte_qjs.*` render glue, `qjs.v` +
`agent.v`. This package consumes them via `buildQjsProd` (over the
`buildQjsLib` archive builder from `@swelte/qjs`) — it owns the
SSR compiler and adapter, not the engine.
```

## Constraints (sync renderer, V-owned data)

`render.js` is your client components compiled with `generate: 'server'`
plus the sync universal load, run in embedded QuickJS (pure-sync, no
I/O). Most guards below are the same universal-code hygiene SvelteKit
enforces — not QuickJS deficits. The genuine QJS delta is
only: no async render, no streaming.

* **No HTML streaming** — one `renderRoute()` call per render (after `@[load]`),
  one HTML string, 50ms render budget then SPA fallback. (SSE event streaming is
  unaffected: it is V-native in `Hand`, intercepted before SSR, and
  works with any engine.)
* **Three shims, not the real internals** — `shims/svelte-crypto.js`
  (throws: CSP-hash branch) and `shims/svelte-render-context.js`
  (module-local context, no ALS; async entry points throw) substitute
  for svelte internals that lazily import Node, plus
  `shims/swelte-sdk-shim.js` (server-shaped stubs for exactly
  `$app|#app/environment`, `$app|#app/paths`,
  `$app/stores|state|navigation`: `browser = false`, router fns throw
  on render; anything else — `#app/secret`, `$app/forms`, `$env/*` —
  is not shimmed and fails the build). Re-verify the two svelte shims
  against upstream on every Svelte upgrade (exact files named in each
  shim header).
* **Cost: ~1MB on top of the binary, ~ms render budget** — measured: 5.1MB → 6.1MB,
  `renderRoute` ~0.012ms in-process, browser `GET /` ~3–12ms wall,
  16MB cap ≈ 200× the bundle. Full numbers in [openspec/specs/ssr/reference.md](https://github.com/eddow/swelte/blob/master/openspec/specs/ssr/reference.md).

Guard failures retain the existing shell/error fallback by default.
`SWELTE_SSR_STRICT=1` rejects unexpected renderer fallback with HTTP 500.
Native diagnostics report route and reason (timeout, memory, output limit,
compile/load or exception) without props or exception bodies. Head and body
output grow within explicit limits; overflow fails rather than dropping head
metadata. See `openspec/specs/ssr/reference.md` for the contract and native acceptance tests.

## Further reading

* [openspec/specs/ssr/reference.md](https://github.com/eddow/swelte/blob/master/openspec/specs/ssr/reference.md) — the built record: ownership, request path,
  `@[load]` cascade, measured budgets, gate halves.
* `c/README.md` — vendored QuickJS version, file list, build.
