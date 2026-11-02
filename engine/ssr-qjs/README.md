# `@swelte/ssr-qjs`

Swelte SSR adapter — embedded QuickJS engine (the default engine).

Re-exports everything from `@swelte/core` so user code swaps one import:

```ts
import { swelte } from '@swelte/ssr-qjs' // instead of '@swelte/core/vite'
```

Core stays engine-agnostic: this package owns ALL engine deps
(`svelte/compiler` at build time, vendored QuickJS at runtime).
Core never imports `svelte/compiler`, `quickjs`, or `bun`.

## Layout

```
src/   compose (ssr.ts) · swelte() wrapper (vite.ts) · QJS link (qjs.ts)
       dev sidecar (dev.ts) · runSsrDev / runSsrCheck (cli.ts)
c/     vendored QuickJS 2026-06-04 (see c/README.md) + swelte_qjs.* glue
shims/ QJS-safe substitutes for two svelte internals (see below)
```

## Limits (vs future `ssr-bun`)

QuickJS is a pure-sync, no-I/O JS engine. Everything below is a
consequence of that — build errors point here, and anything listed as
"bun later" is out of scope for this adapter by design, not by schedule.

* **No `await` in components top-level** — top-level `await` is a build error
  (the bundle must stay a pure-sync renderer). `await` inside
  handlers is fine: it ships to the browser in the client bundle,
  it just never runs during SSR. *Bun later: async/Suspense.*
* **No `fetch()` during render** — top-level `fetch` is a build error;
  initial-paint data comes from `@[load]` in V, interaction data from
  RPC stubs in handlers. *Bun later: full fetch/npm compat in the
  sidecar (never in the binary).*
* **No `node:` imports** — build error, including dynamic
  `import('node:…')`. The bundle runs in QuickJS, not Node.
  *Bun later: npm compat.*
* **No HTML streaming** — one `renderRoute()` call per render (after `@[load]`),
  one HTML string, 50ms render budget then SPA fallback. (SSE event streaming is
  unaffected: it is V-native in `Hand`, intercepted before SSR, and
  works with any engine.) *Bun later: chunked HTML via the sidecar.*
* **Two shims, not the real internals** — `shims/svelte-crypto.js`
  (throws: CSP-hash branch) and `shims/svelte-render-context.js`
  (module-local context, no ALS; async entry points throw) substitute
  for svelte internals that lazily import Node. Re-verify against
  upstream on every Svelte upgrade (exact files named in each shim).
* **~1MB on top of the binary, ~ms render budget** — measured: 5.1MB → 6.1MB,
  `renderRoute` ~0.012ms in-process, browser `GET /` ~3–12ms wall,
  16MB cap ≈ 200× the bundle. Full numbers in [docs/ssr.md](https://github.com/eddow/swelte/blob/main/docs/ssr.md).

When a limit bites, the failure mode is always the same: SPA shell
or `+error` HTML with the right status — never blank, never JSON
for navigations, server stays up.

## Further reading

* [docs/ssr.md](https://github.com/eddow/swelte/blob/main/docs/ssr.md) — the built record: ownership, request path,
  `@[load]` cascade, measured budgets, gate halves.
* `c/README.md` — vendored QuickJS version, file list, build.
