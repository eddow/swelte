// `@swelte/plus` — jobs scheduler + embedded SQLite/KV + rooms plugins.
// Explicit registration: `swelte({ plugins: [jobsPlugin, dbPlugin, roomsPlugin] })`
// (or `createJobsPlugin({ durable: true })`). Rooms/hub live in §3 box 3
// (`roomsPlugin` claims `@[ws]` + room-mode `@[sse]`; core keeps plain SSE).
export { roomsPlugin, validateRoomSseFn, validateRoomWsFn, plusRoomsVlibDir } from './rooms.js'

export {
	createJobsPlugin,
	cronHarness,
	jobsPlugin,
	PLUS_CRON_MAX_RETRY,
	PLUS_CRON_RETRY_STEP_S,
	plusCronParse,
	plusCronSeconds,
	readJobsCrons,
	validateCronFn,
} from './jobs.js'
export {
	dbHelperTemplate,
	dbInitialMigration,
	dbPlugin,
	migrateCommand,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
	plusDbPath,
	plusDbVlibDir,
	plusPendingMigrations,
	renderMigrateProgram,
	runMigrate,
} from './db.js'
