# `@swelte/ssr-qjs`

Swelte SSR adapter — embedded QuickJS engine (the default engine).

Re-exports everything from `@swelte/core` so user code swaps one import:

```ts
import { swelte } from '@swelte/ssr-qjs' // instead of '@swelte/core/vite'
```

Core stays engine-agnostic: this package owns ALL engine deps
(`svelte/compiler` for `generate: 'server'`, QuickJS at runtime).
Core never imports `svelte/compiler`, `quickjs`, or `bun`.

## Layout

```
src/
  index.ts    re-export * from core + swelte() + compose helpers
  vite.ts     swelte() wrapper: core plugin + generateBundle → dist/ssr/render.js
  ssr.ts      composeRenderJs() + assertQjsCompatible() build guard
  v-shim.v    swelte_qjs_* V bridge stub (item-23 verbatim-copy pattern)
c/            vendored quickjs.c amalgamation (prod link target)
```

## Status (Phase 2 scaffold)

- [x] Manifest composer (`composeRenderJs`) + QJS-compat guard
- [x] `swelte()` wrapper returning `[core, adapter]` plugins
- [ ] Real `generate: 'server'` component compilation (needs svelte/compiler spike)
- [ ] Dev disk-read bridge + HMR guard
- [ ] `qjsc` bytecode + V C-interop link + timeout/mem caps
