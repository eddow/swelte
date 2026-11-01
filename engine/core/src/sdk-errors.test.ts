import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
	SwelteRpcError,
	loadPage,
	isPageError,
	isPageData,
	isFail,
	deserialize,
	__swelteFetch,
	__swelteWasmCall,
	__registerLibFallback,
} from './sdk.js'

describe('SDK error contract', () => {
	let origFetch: typeof fetch | undefined
	beforeEach(() => {
		origFetch = globalThis.fetch
	})
	afterEach(() => {
		globalThis.fetch = origFetch as typeof fetch
	})

	it('message includes fn/base/status/available/hint', () => {
		const err = new SwelteRpcError('/api', 'login', 404, {
			error: 'unknown fn',
			available: ['a', 'b'],
			hint: 'try q',
		}, 'raw')
		assert.ok(err.message.includes('"login"'))
		assert.ok(err.message.includes('/api'))
		assert.ok(err.message.includes('404'))
		assert.ok(err.message.includes('a, b'))
		assert.ok(err.message.includes('try q'))
	})

	it('404 JSON body parsed', async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: 'unknown fn', available: ['x'] }), {
				status: 404,
			})) as typeof fetch
		await assert.rejects(() => __swelteFetch('/b', 'fn', 'rpc', {}), (e: unknown) => {
			const err = e as SwelteRpcError
			return err instanceof SwelteRpcError && err.body?.available?.[0] === 'x'
		})
	})

	it('raw text fallback when body is not JSON', async () => {
		globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
		await assert.rejects(() => __swelteFetch('/b', 'fn', 'rpc', {}), (e: unknown) => {
			const err = e as SwelteRpcError
			return err instanceof SwelteRpcError && err.message.includes('boom') && err.body === null
		})
	})

	it('loadPage maps SwelteRpcError -> { error } and non-RPC -> 500', async () => {
		const r1 = await loadPage(() => __swelteFetch('/b', 'f', 'rpc', {}))
		// fetch mock above persists per-test; set a failing fetch here:
		globalThis.fetch = (async () => new Response('x', { status: 404 })) as typeof fetch
		const r2 = await loadPage(async () => {
			throw new SwelteRpcError('/b', 'f', 404, { error: 'nf' }, 'nf')
		})
		assert.ok(isPageError(r2))
		if (isPageError(r2)) assert.equal(r2.error.status, 404)
		const r3 = await loadPage(async () => {
			throw new Error('kaput')
		})
		assert.ok(isPageError(r3))
		if (isPageError(r3)) assert.equal(r3.error.status, 500)
		const ok = await loadPage(async () => 42)
		assert.ok(isPageData(ok))
		if (isPageData(ok)) assert.equal(ok.data, 42)
		void r1
	})

	it('wasm fallback map hit without fetch', async () => {
		__registerLibFallback('pure_add', (args) => (args['a'] as number) + 1)
		const v = await __swelteWasmCall<number>('/nope.wasm', 'main.pure_add', { a: 1 }, [], 'int')
		assert.equal(v, 2)
	})

	it('wasm unknown fn without fallback -> status-0 shape', async () => {
		await assert.rejects(
			() => __swelteWasmCall('/w.wasm', 'main.missing_fn', {}, [], 'string'),
			(e: unknown) => {
				const err = e as SwelteRpcError
				// Fetch-failure path carries the fetch error + an (empty)
				// `available` list — same envelope as the unknown-fn path,
				// so callers can always read `body.available`.
				return (
					err instanceof SwelteRpcError &&
					err.status === 0 &&
					Array.isArray(err.body?.available)
				)
			}
		)
	})

	it('§2.11 isFail narrows fail-lite bodies, optional status', () => {
		const fail = new SwelteRpcError('/b', 'save', 422, { error: 'bad', ok: false, fieldErrors: { name: 'required' } }, '')
		assert.ok(isFail(fail))
		assert.ok(isFail(fail, 422))
		assert.ok(!isFail(fail, 400))
		const plain = new SwelteRpcError('/b', 'save', 422, { error: 'bad' }, '')
		assert.ok(!isFail(plain))
		assert.ok(!isFail(new Error('x')))
		const wrongStatus = new SwelteRpcError('/b', 'save', 200, { error: 'x', ok: false, fieldErrors: {} }, '')
		assert.ok(!isFail(wrongStatus))
	})

	it('§2.12 deserialize parses action envelopes', async () => {
		const r1 = await deserialize(
			new Response(JSON.stringify({ type: 'success', status: 200, data: { id: 1 } }), { status: 200 })
		)
		assert.equal(r1.type, 'success')
		const r2 = await deserialize(
			new Response(JSON.stringify({ type: 'failure', status: 422, data: { ok: false } }), { status: 200 })
		)
		assert.equal(r2.type, 'failure')
		if (r2.type === 'failure') assert.equal(r2.status, 422)
		const r3 = await deserialize(
			new Response(JSON.stringify({ type: 'redirect', status: 303, location: '/done' }), { status: 200 })
		)
		assert.equal(r3.type, 'redirect')
		await assert.rejects(() => deserialize(new Response('not json', { status: 200 })), /not JSON/)
		await assert.rejects(
			() => deserialize(new Response(JSON.stringify({ type: 'weird' }), { status: 200 })),
			/unknown type/
		)
	})
})
