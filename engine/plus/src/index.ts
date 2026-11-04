// `@swelte/plus` — beyond-SvelteKit plugins (today: jobs/cron only).
// Depends on `@swelte/core` (core stays standalone — apps not using cron
// never install this package). Core owns the `SweltePlugin` contract
// (`@swelte/core/vite`); plus implements it.
export { jobsPlugin, plusCronSeconds } from './jobs.js'
export type { JobsCronDef } from './jobs.js'
export { defineSweltePlugin } from '@swelte/core/vite'
export type { SweltePlugin, SweltePluginHarness, SweltePluginRouteCtx } from '@swelte/core/vite'
