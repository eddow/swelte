// `@swelte/plus` — jobs scheduler plugin (`@[cron]`, durable scheduling).
// Explicit registration: `swelte({ plugins: [jobsPlugin] })` (or
// `createJobsPlugin({ durable: true })`). DB/rooms stay in core until
// §3 boxes 2–3 move them here.

export type { CronFnShape, JobsCronDef, PlusCronQualifier } from './jobs.js'
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
