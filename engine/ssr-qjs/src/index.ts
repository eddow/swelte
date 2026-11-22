// `@swelte/ssr-qjs` — default SSR adapter (embedded QuickJS).
// Re-exports everything from `@swelte/core` so user code swaps one import:
//
//   import { swelte } from '@swelte/ssr-qjs'  // instead of '@swelte/core/vite'
//
// Core stays engine-agnostic: this package owns ALL engine deps
// (svelte/compiler for generate:'server', qjs at runtime). Core never
// imports svelte/compiler, quickjs, or a JS runtime.
export * from '@swelte/core'
export { buildQjsLib, type QjsLibOut, qjsCDir, whichCC } from '@swelte/qjs'
export type { SsrCheckOptions } from './cli.js'
export { runSsrCheck } from './cli.js'
export type { SsrDevOptions } from './dev.js'
export { defaultSsrDevPort, renderFileFor, startSsrDevServer } from './dev.js'
export { buildQjsProd, type QjsProdOut } from './qjs.js'
export {
	assertNoNodeExternals,
	assertNoSdkTopLevelCalls,
	assertNoTopLevelStubCalls,
	assertQjsCompatible,
	assertUniversalLoadSync,
	bundleSsr,
	compileSsrComponent,
	composeRenderJs,
	emitRenderJs,
	readUniversalSsrFlag,
	type SsrComposeOptions,
	type SsrManifest,
	transpileSiblingLoad,
} from './ssr.js'
export { ssrPlugin, swelte } from './vite.js'
