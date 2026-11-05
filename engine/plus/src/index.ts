// Plus (`@swelte/plus`) — beyond-SvelteKit plugins (jobs/cron, db/sqlite).
// Depends on `@swelte/core` (core stays standalone — apps not using cron
// or db never install this package). Core owns the `SweltePlugin` contract
// (`@swelte/core/vite`); plus implements it.
export {
	jobsPlugin,
	plusCronParse,
	plusCronSeconds,
	PLUS_CRON_MAX_RETRY,
	PLUS_CRON_RETRY_STEP_S,
} from './jobs.js'
export type { JobsCronDef } from './jobs.js'
export {
	dbPlugin,
	dbHelperTemplate,
	dbInitialMigration,
	plusDbPath,
	plusDbVlibDir,
	plusPendingMigrations,
	runMigrate,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
} from './db.js'
export { defineSweltePlugin } from '@swelte/core/vite'
export type { SweltePlugin, SweltePluginHarness, SweltePluginRouteCtx } from '@swelte/core/vite'
