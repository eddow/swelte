/** @swelte/core/vite — public plugin entry (stable import path).
 *
 *  Split from a single 4,838-line module into `vite/*` by concern;
 *  this barrel preserves the exact public surface (`./vite.js` output,
 *  `@swelte/core/vite` subpath, `dist/vite.d.ts`), plus four
 *  additive chunking helpers promoted from private scope:
 *  `assertChunkHint`, `chunkKeyFor`, `readChunkHint`, `WrapperMw`.
 */

export type { SwelteConfig, SwelteOptions } from './gen/config.js'
export { defineConfig } from './gen/config.js'
export { cronSeconds, loadServerHooks } from './vite/hooks.js'
export { dynSegPattern, loadMatchers, transpileMatcherBody } from './vite/matchers.js'
export { narrowArgParts, narrowCall, parseStructs, parseVFile, tsTypeFor } from './vite/parse.js'
export { swelte, swelte as default } from './vite/plugin.js'
export {
	assertChunkHint,
	chunkKeyFor,
	collectPrerenderEntries,
	collectSvelteManifest,
	dynSegMatcher,
	dynSegName,
	dynSegPatternGlobal,
	isStaticRoute,
	modulePath,
	readChunkHint,
	relPosix,
	routeFor,
	routeParams,
	routeParamTs,
	siblingLoadSource,
	stripRouteGroups,
	svelteModKind,
	svelteRouteFor,
	universalLoadKind,
	validateDynamicSegs,
	vFileSafe,
	vPrefix,
} from './vite/routes.js'
export {
	renderServiceWorker,
	renderServiceWorkerRegister,
	serviceWorkerEnabled,
	serviceWorkerPrecache,
	serviceWorkerRegisterMode,
} from './vite/service-worker.js'
export { jsFetchFor, jsWasmFor, wasmParamKind, wasmReturnKind } from './vite/stubs.js'
export type {
	CronHook,
	LoadFn,
	MatcherDef,
	PrerenderCrawl,
	RpcFn,
	RpcParam,
	ServerHooks,
	SvelteRouteEntry,
	SweltePluginOptions,
	VStruct,
	WrapperMw,
} from './vite/types.js'
