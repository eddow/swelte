import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RunRequirements } from '../src/lib/capabilities.js'
import { checkOpenRouterFit, OpenRouterAdapter, openRouterFromEnv } from '../src/lib/openrouter.js'

const REQ: RunRequirements = { input: ['text'], output: ['text'] }

function fakeFetch(chunks: string[], onRequest?: (req: Request) => void): typeof fetch {
	const text = chunks.join('')
	const bytes = new TextEncoder().encode(text)
	return (async (url: string | URL | Request, init?: RequestInit) => {
		if (onRequest && typeof url === 'string')
			onRequest(new Request(url, { method: init?.method, headers: init?.headers }))
		return new Response(bytes, { status: 200, headers: { 'content-type': 'text/event-stream' } })
	}) as unknown as typeof fetch
}

const STREAM = [
	'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
	'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
	'data: [DONE]\n\n',
]

describe('openrouter adapter', () => {
	it('gates model and requirements before any network', () => {
		assert.throws(() => new OpenRouterAdapter({ apiKey: '', model: 'm' }), /apiKey/)
		assert.throws(
			() => new OpenRouterAdapter({ apiKey: 'k', model: 'm', allowlist: ['other'] }),
			/allowlist/
		)
		assert.ok(checkOpenRouterFit({ input: ['video'], output: ['text'] }, { model: 'm' }))
		assert.ok(checkOpenRouterFit({ ...REQ, toolCalls: true }, { model: 'm' }))
		assert.equal(checkOpenRouterFit(REQ, { model: 'm', allowlist: ['m'] }), null)
	})
	it('streams deltas + usage + terminal from SSE', async () => {
		let auth = ''
		const a = new OpenRouterAdapter({
			apiKey: 'secret',
			model: 'm',
			fetch: fakeFetch(STREAM, (r) => (auth = r.headers.get('authorization') ?? '')),
		})
		const kinds: string[] = []
		const texts: string[] = []
		const seen: { usage?: unknown; reason?: unknown }[] = []
		for await (const e of a.run('hi', REQ)) {
			kinds.push(e.envelope.kind)
			if (e.envelope.kind === 'text.delta') texts.push((e.payload as { text: string }).text)
			if (e.envelope.kind === 'terminal')
				seen.push(e.payload as { usage?: unknown; reason?: unknown })
		}
		assert.deepEqual(kinds, ['text.delta', 'text.delta', 'terminal'])
		assert.equal(texts.join(''), 'hello')
		assert.equal(auth, 'Bearer secret')
		assert.deepEqual((seen[0].usage as { inputTokens: number }).inputTokens, 3)
		assert.equal(seen[0].reason, 'completed')
	})
	it('sends system prompt + bearer key, traces events', async () => {
		const traced: string[] = []
		let body = ''
		const a = new OpenRouterAdapter({
			apiKey: 'k',
			model: 'm',
			onEvent: (e) => traced.push(e.kind),
			fetch: (async (_url: unknown, init?: { body?: string }) => {
				body = String(init?.body ?? '')
				return new Response(new TextEncoder().encode('data: [DONE]\n\n'), { status: 200 })
			}) as unknown as typeof fetch,
		})
		for await (const _ of a.run('hi', REQ, { system: 'sys' })) {
			/* drain */
		}
		assert.ok(body.includes('"role":"system"'))
		assert.ok(traced.includes('terminal'))
	})
	it('fails loudly on HTTP errors; cancels via AbortSignal', async () => {
		const bad = new OpenRouterAdapter({
			apiKey: 'k',
			model: 'm',
			fetch: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
		})
		await assert.rejects(async () => {
			for await (const _ of bad.run('hi', REQ)) {
				/* expect throw before first yield */
			}
		}, /HTTP 401/)
		const c = new AbortController()
		const slow = new OpenRouterAdapter({
			apiKey: 'k',
			model: 'm',
			fetch: (async () => {
				const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n')
				// Never-resolving body until abort: adapter must surface cancelled terminal.
				const stream = new ReadableStream({
					start(c) {
						c.enqueue(bytes)
					},
					cancel() {},
				})
				return new Response(stream, { status: 200 })
			}) as unknown as typeof fetch,
		})
		const kinds: string[] = []
		let terminal: unknown = null
		// Abort mid-stream, not before fetch: exercises the adapter cancel path.
		const p = (async () => {
			for await (const e of slow.run('hi', REQ, { signal: c.signal })) {
				kinds.push(e.envelope.kind)
				if (e.envelope.kind === 'text.delta') c.abort()
				if (e.envelope.kind === 'terminal') terminal = (e.payload as { reason: unknown }).reason
			}
		})()
		await p
		assert.ok(kinds.includes('text.delta'))
		assert.equal(terminal, 'cancelled')
	})
	it('fromEnv reads server env only, refuses missing keys', () => {
		assert.throws(() => openRouterFromEnv({}, { model: 'm' }), /missing OPENROUTER_API_KEY/)
		const a = openRouterFromEnv({ OPENROUTER_API_KEY: 'k' }, { model: 'm' })
		assert.equal(a.model, 'm')
	})
})
