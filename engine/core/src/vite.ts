/** @swelte/core/vite — public plugin entry (stable import path).
 *
 *  Split from a single 4,838-line module into `vite/*` by concern;
 *  this barrel preserves the exact public surface (`./vite.js` output,
 *  `@swelte/core/vite` subpath, `dist/vite.d.ts`), plus four
 *  additive chunking helpers promoted from private scope:
 *  `assertChunkHint`, `chunkKeyFor`, `readChunkHint`, `WrapperMw`.
 */

export type { CronFnShape, JobsCronDef, PlusCronQualifier } from './backend/jobs-index.js'
export {
	builtinDbPlugin,
	builtinJobsPlugin,
	coreBackendVlibDir,
	createBuiltinJobsPlugin,
	createJobsPlugin,
	cronHarness,
	dbHelperTemplate,
	dbInitialMigration,
	dbPlugin,
	jobsPlugin,
	migrateCommand,
	PLUS_CRON_MAX_RETRY,
	PLUS_CRON_RETRY_STEP_S,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
	plusCronParse,
	plusCronSeconds,
	plusDbPath,
	plusDbVlibDir,
	plusPendingMigrations,
	readJobsCrons,
	runMigrate,
	validateCronFn,
} from './backend/jobs-index.js'
export type { SwelteConfig, SwelteOptions } from './gen/config.js'
export { defineConfig } from './gen/config.js'
export type { ErrorBoundary } from './vite/error-boundaries.js'
export {
	collectErrorBoundaries,
	errorBoundaryProps,
	selectErrorBoundaries,
} from './vite/error-boundaries.js'
export { loadServerHooks } from './vite/hooks.js'
export { dynSegPattern, loadMatchers, transpileMatcherBody } from './vite/matchers.js'
export {
	CORE_ATTRS,
	narrowArgParts,
	narrowCall,
	parseStructs,
	parseVFile,
	tsTypeFor,
} from './vite/parse.js'
export { swelte, swelte as default } from './vite/plugin.js'
export {
	assertChunkHint,
	assertLayoutHint,
	assertLimitsHint,
	assertPrerenderHint,
	assertSerializedHeadersHint,
	chunkKeyFor,
	collectPrerenderEntries,
	collectSvelteManifest,
	dynSegMatcher,
	dynSegName,
	dynSegPatternGlobal,
	isStaticRoute,
	modulePath,
	partitionPrerender,
	readChunkHint,
	readCsrFlag,
	readLayoutHint,
	readPrerenderHint,
	readSsrFlag,
	relPosix,
	resolveLayoutHint,
	routeFor,
	routeParams,
	routeParamTs,
	siblingLoadSource,
	siblingSrc,
	stripRouteGroups,
	svelteModKind,
	svelteRouteFor,
	universalLoadKind,
	validateDynamicSegs,
	vFileSafe,
	vPrefix,
} from './vite/routes.js'
export {
	emitServerGen,
	validateLoadFn,
	validateMiddlewareFn,
	validateSseFn,
	validateWsFn,
} from './vite/server-gen.js'
export {
	renderServiceWorker,
	renderServiceWorkerRegister,
	serviceWorkerEnabled,
	serviceWorkerPrecache,
	serviceWorkerRegisterMode,
} from './vite/service-worker.js'
export { jsFetchFor, jsWasmFor, wasmParamKind, wasmReturnKind } from './vite/stubs.js'
export type {
	LoadFn,
	MatcherDef,
	PrerenderCrawl,
	RouteLimits,
	RpcFn,
	RpcParam,
	ServerHooks,
	SvelteRouteEntry,
	SweltePlugin,
	SweltePluginDeclaration,
	SweltePluginGenerateCtx,
	SweltePluginHarness,
	SweltePluginInclude,
	SweltePluginOptions,
	SweltePluginRouteCtx,
	SweltePluginResolved,
	VStruct,
	WrapperMw,
} from './vite/types.js'
export { defineSweltePlugin } from './vite/types.js'
export {
	assertPluginCli,
	assertPluginName,
	collectPluginDeclarations,
	dedupPlugins,
	pluginAttrOwners,
	writePluginOutputs,
} from './vite/plugins.js'

export type { SwelteBuildPhase, BuildPhaseFile } from './vite/build.js'
