/** Explicit opt-in to persistent delivery. The endpoint must deduplicate the
 * Idempotency-Key across retries and lost acknowledgements. */
export interface OutboxEntry {
	id: string
	url: string
	method: string
	state: 'pending' | 'failed'
	attempts: number
	createdAt: number
	nextAttemptAt: number
	failure: string | null
}

let outboxOnlineInstalled = false

async function outboxMessage(
	operation: string,
	data: Record<string, unknown> = {}
): Promise<unknown> {
	if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller)
		throw new Error('outbox requires a controlling Swelte service worker')
	if (!outboxOnlineInstalled) {
		outboxOnlineInstalled = true
		globalThis.addEventListener?.('online', () => {
			void outboxMessage('flush').catch(() => {})
		})
	}
	const channel = new MessageChannel()
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			channel.port1.close()
			reject(new Error('outbox worker timed out'))
		}, 45000)
		channel.port1.onmessage = (event) => {
			clearTimeout(timer)
			channel.port1.close()
			if (event.data.error) reject(new Error(event.data.error))
			else resolve(event.data.result)
		}
		navigator.serviceWorker.controller!.postMessage(
			{ type: `swelte:outbox:${operation}`, ...data },
			[channel.port2]
		)
	})
}

export async function enqueueOffline(
	input: RequestInfo | URL,
	init: RequestInit = {}
): Promise<string> {
	const request = new Request(input, { ...init, credentials: init.credentials ?? 'omit' })
	if (request.credentials === 'include')
		throw new Error('outbox credentials must be omit or same-origin')
	const body = await request.arrayBuffer()
	return (await outboxMessage('enqueue', {
		request: {
			url: request.url,
			method: request.method,
			headers: [...request.headers],
			body,
			credentials: request.credentials,
		},
	})) as string
}
export async function listOutbox(): Promise<OutboxEntry[]> {
	return (await outboxMessage('list')) as OutboxEntry[]
}
export async function flushOutbox(): Promise<boolean> {
	return (await outboxMessage('flush')) as boolean
}
export async function retryOutbox(id: string): Promise<void> {
	await outboxMessage('retry', { id })
}
export async function discardOutbox(id: string): Promise<void> {
	await outboxMessage('discard', { id })
}
