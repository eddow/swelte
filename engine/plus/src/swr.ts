// `@swelte/plus/swr` — ISR → SWR background regen (future.md #5).
// Core stays headers-only (`Cache-Control: s-maxage` + `X-Swelte-Revalidate`).
// Plus re-renders on a timer and swaps `dist/*.html` atomically (v1: plugin
// registration + config passthrough; regen loop lands next).
import { defineSweltePlugin, type SweltePlugin } from '@swelte/core/vite'

export const swrPlugin: SweltePlugin = defineSweltePlugin({
	name: 'swr',
	attrs: [],
	configKey: 'swr',
	emitServerGen: () => '',
})
