// `@swelte/plus/sse-channels` — SSE broadcast primitive (future.md #4).
// Core stays per-request (`emit` param / `[]string` list). Plus adds named
// channels: `emit_to(room, msg)` V helper + `swelte:join` client protocol.
import { defineSweltePlugin, type SweltePlugin } from '@swelte/core/vite'

const CHANNEL_RE = /^[A-Za-z0-9_-]{1,64}$/

export function assertChannelName(room: string): void {
	if (!CHANNEL_RE.test(room)) {
		throw new Error(
			`[swelte:plus] bad SSE channel '${room}' — want 1-64 [A-Za-z0-9_-] (future.md #4).`
		)
	}
}

/** Client join frame: first event on a channel stream (`data: swelte:join:<room>`). */
export function channelJoinFrame(room: string): string {
	assertChannelName(room)
	return `swelte:join:${room}`
}

export function parseChannelJoinFrame(data: string): string | null {
	const m = /^swelte:join:([A-Za-z0-9_-]{1,64})$/.exec(data)
	return m ? (m[1] as string) : null
}

export const sseChannelsPlugin: SweltePlugin = defineSweltePlugin({
	name: 'sse-channels',
	attrs: [],
	configKey: 'sseChannels',
	emitServerGen: () => '',
})
