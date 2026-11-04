// `@swelte/plus` — beyond-SvelteKit plugins (today: jobs/cron only).
// Depends on `@swelte/core` (core stays standalone — apps not using cron
// never install this package). Core owns the `SweltePlugin` contract
// (`@swelte/core/vite`); plus implements it.
// SSE stays in core (per-request list/emit is SvelteKit parity, not beyond).
// sse-channels / swr / outbox were unbuilt skeletons (helpers + empty
// `emitServerGen`) — removed until they have real emission behind them.
export { jobsPlugin, plusCronSeconds } from './jobs.js'
export type { JobsCronDef } from './jobs.js'
export { defineSweltePlugin } from '@swelte/core/vite'
export type { SweltePlugin, SweltePluginHarness, SweltePluginRouteCtx } from '@swelte/core/vite'
