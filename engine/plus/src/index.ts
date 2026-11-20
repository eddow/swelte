// `@swelte/plus` — DEPRECATED empty shim (jobs + backend live in core).
// This package exists only so existing `npm install @swelte/plus` setups
// keep resolving. New code imports from `@swelte/core` (or
// `@swelte/core/vite`, `@swelte/core/jobs`, `@swelte/core/db`) directly —
// no `plugins: [...]` entry needed, both are always builtin.

export type {
	CronFnShape,
	JobsCronDef,
	PlusCronQualifier,
	SweltePlugin,
	SweltePluginHarness,
	SweltePluginRouteCtx,
} from '@swelte/core/vite'
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
	defineSweltePlugin,
	jobsPlugin,
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
} from '@swelte/core/vite'
