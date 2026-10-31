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
  vite.ts     swelte() wrapper: core plugin + generateBundle → dist/ssr/render.js + QJS link
  ssr.ts      composeRenderJs() + assertQjsCompatible() build guard
  qjs.ts      buildQjsProd(): vendored QJS → libqjs.a + routes/swelte_qjs_bridge.v
  dev.ts      dev sidecar (SWELTE_SSR_URL) + HMR guard
  cli.ts      runSsrDev / runSsrCheck (§5 gate as CI)
  v-shim.v    legacy stub (superseded by the generated bridge)
c/            vendored QuickJS 2026-06-04 (see c/README.md) + swelte_qjs.* glue
```

## Status

- [x] Manifest composer (`composeRenderJs`) + QJS-compat guard
- [x] `swelte()` wrapper returning `[core, adapter]` plugins
- [x] Real `generate: 'server'` component compilation + Rollup bundle
- [x] Dev disk-read bridge + HMR guard
- [x] **QJS prod link** (`§1 done`): `buildQjsProd` compiles vendored
      QuickJS to `.swelte/qjs/libqjs.a` + emits
      `.swelte/routes/swelte_qjs_bridge.v`
      (`routes.swelte_qjs_render_page(route, props) (string, bool)`).
      `swelte build` regenerates after `vite build` (bridge pass) and
      compiles with `-enable-globals -cc gcc` when the bridge is present.
      Proven: `dist/server` + `dist/` on one port — `/` 200 SSR HTML with
      markers, `/nope` 404 `+error` HTML, `/admin` 400 `+error` HTML,
      JSON bypass intact, server stays up. Design constraints (V 0.5.2):
      glue never returns malloc'd pointers (autofree double-frees) — V
      passes a 64KB→1MB stack buffer, C copies the body HTML in and
      reports the needed length; runtimes are C-side int handles (V
      truncates u64 C values to 32 bits); `free()` always from C, never
      `C.free()` from V. Binary delta: +~1MB (5.1MB → 6.1MB).
- [x] **`§5 gate as CI` (`§4 done`)**: `runSsrCheck` asserts `/` HTML +
      markers, `/nope` +error fallback, single `dist/ssr/` artifact.
      Core smoke stays static/SPA + JSON (no Accept) — SSR bytes only
      flow on real browser Accepts (`text/html`), so curl probes and the
      core build smoke never see SSR output.
