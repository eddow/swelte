// `@swelte/ssr-qjs` — default SSR adapter (embedded QuickJS).
// Re-exports everything from `@swelte/core` so user code swaps one import:
//
//   import { swelte } from '@swelte/ssr-qjs'  // instead of '@swelte/core/vite'
//
// Core stays engine-agnostic: this package owns ALL engine deps
// (svelte/compiler for generate:'server', qjs at runtime). Core never
// imports svelte/compiler, quickjs, or bun.
export * from '@swelte/core'
export { VERSION } from '@swelte/core'
export { swelte } from './vite.js'
export { composeRenderJs, type SsrComposeOptions } from './ssr.js'
