// `@swelte/ssr-qjs` — default SSR adapter (embedded QuickJS).
// Re-exports everything from `@swelte/core` so user code swaps one import:
//
//   import { swelte } from '@swelte/ssr-qjs'  // instead of '@swelte/core/vite'
//
// Core stays engine-agnostic: this package owns ALL engine deps
// (svelte/compiler for generate:'server', qjs at runtime). Core never
// imports svelte/compiler, quickjs, or bun.
export * from '@swelte/core'
export { swelte } from './vite.js'
export {
	assertNoNodeExternals,
	assertNoSdkTopLevelCalls,
	assertNoTopLevelStubCalls,
	assertQjsCompatible,
	assertUniversalLoadSync,
	readUniversalSsrFlag,
	transpileSiblingLoad,
	bundleSsr,
	compileSsrComponent,
	composeRenderJs,
	emitRenderJs,
	type SsrComposeOptions,
	type SsrManifest,
} from './ssr.js'
export { defaultSsrDevPort, renderFileFor, startSsrDevServer } from './dev.js'
export type { SsrDevOptions } from './dev.js'
export { runSsrCheck, runSsrDev } from './cli.js'
export type { SsrDevRunOptions } from './cli.js'
export {
	buildQjsProd,
	qjsCDir,
	whichCC,
	type QjsProdOut,
} from './qjs.js'
