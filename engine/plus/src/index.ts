// `@swelte/plus` — beyond-SvelteKit plugins (jobs, SSE channels, SWR, offline outbox).
// Depends on `@swelte/core` (core stays standalone — apps not using SSE/WS/jobs
// never install this package). Core owns the `SweltePlugin` contract
// (`@swelte/core/vite`); plus implements it.
export { jobsPlugin, plusCronSeconds } from './jobs.js'
export { outboxPlugin, outboxKey, OUTBOX_DB, OUTBOX_STORE } from './outbox.js'
export type { OutboxEntry } from './outbox.js'
export {
	sseChannelsPlugin,
	assertChannelName,
	channelJoinFrame,
	parseChannelJoinFrame,
} from './sse-channels.js'
export { swrPlugin } from './swr.js'
export { defineSweltePlugin } from '@swelte/core/vite'
export type { SweltePlugin, SweltePluginHarness, SweltePluginRouteCtx } from '@swelte/core/vite'
