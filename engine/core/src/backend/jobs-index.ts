// `@swelte/core/backend` — builtin jobs scheduler + embedded backend.
// Import graph: `vite/*` and `commands/*` import from here; this module
// never imports `vite/*` (no cycle). The two sibling modules stay
// cycle-free too (`jobs.ts` has no db dep; `db.ts` imports `toolchain.js`
// + `vite/types.js` only).

export {
	coreBackendVlibDir,
	dbHelperTemplate,
	dbInitialMigration,
	dbPlugin as builtinDbPlugin,
	dbPlugin,
	migrateCommand,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
	plusDbPath,
	plusDbVlibDir,
	plusPendingMigrations,
	runMigrate,
} from './db.js'
export type { CronFnShape, JobsCronDef, PlusCronQualifier } from './jobs.js'
// Back-compat alias (deprecation shim path): the recommended config key is
// `jobs: { durable: true }`; `createJobsPlugin` stays for explicit instances.
export {
	createJobsPlugin,
	createJobsPlugin as createBuiltinJobsPlugin,
	cronHarness,
	jobsPlugin,
	jobsPlugin as builtinJobsPlugin,
	PLUS_CRON_MAX_RETRY,
	PLUS_CRON_RETRY_STEP_S,
	plusCronParse,
	plusCronSeconds,
	readJobsCrons,
	validateCronFn,
} from './jobs.js'
