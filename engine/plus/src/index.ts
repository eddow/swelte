// Plus (`@swelte/plus`) — beyond-SvelteKit plugins (jobs/cron, db/sqlite).
// Depends on `@swelte/core` (core stays standalone — apps not using cron
// or db never install this package). Core owns the `SweltePlugin` contract
// (`@swelte/core/vite`); plus implements it.

export type { SweltePlugin, SweltePluginHarness, SweltePluginRouteCtx } from '@swelte/core/vite'
export { defineSweltePlugin } from '@swelte/core/vite'
export {
	dbHelperTemplate,
	dbInitialMigration,
	dbPlugin,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
	plusDbPath,
	plusDbVlibDir,
	plusPendingMigrations,
	runMigrate,
} from './db.js'
export type { JobsCronDef } from './jobs.js'
export {
	jobsPlugin,
	PLUS_CRON_MAX_RETRY,
	PLUS_CRON_RETRY_STEP_S,
	plusCronParse,
	plusCronSeconds,
} from './jobs.js'
