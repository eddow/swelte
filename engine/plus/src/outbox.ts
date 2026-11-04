// `@swelte/plus/outbox` — offline outbox (future.md #7).
// Core service worker is network-first for API (offline => caller sees the
// failure). Plus queues failed POSTs and replays on reconnect (background-sync).
// v1: plugin registration + queue key helpers; SW snippet + replay next.
import { defineSweltePlugin, type SweltePlugin } from '@swelte/core/vite'

export const OUTBOX_DB = 'swelte-outbox'
export const OUTBOX_STORE = 'requests'

export interface OutboxEntry {
	id: string
	url: string
	method: string
	body?: string
	headers?: Record<string, string>
	ts: number
}

export function outboxKey(entry: Pick<OutboxEntry, 'url' | 'method' | 'ts'>): string {
	return `${entry.method}:${entry.url}:${entry.ts}`
}

export const outboxPlugin: SweltePlugin = defineSweltePlugin({
	name: 'outbox',
	attrs: [],
	configKey: 'outbox',
	emitServerGen: () => '',
})
