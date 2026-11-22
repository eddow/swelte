// `@swelte/core/backend` — embedded backend (db). Jobs (`@[cron]`) moved to
// `@swelte/plus` (§3 box 1); `vite/*` and `commands/*` import from here,
// this module never imports `vite/*` (no cycle). `db.ts` imports
// `toolchain.js` + `vite/types.js` only.
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
