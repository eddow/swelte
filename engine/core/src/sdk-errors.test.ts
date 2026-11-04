import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
	SwelteRpcError,
	__swelteActionResult,
	applyAction,
	checkUpdated,
	clearFetchHooks,
	captureSnapshot,
	restoreSnapshot,
	__swelteCaptureSnapshot,
	__swelteRestoreSnapshot,
	enhance,
	handleFetch,
	isFail,
	isRedirect,
	loadPage,
	isPageError,
	isPageData,
	deserialize,
	__swelteFetch,
	__swelteWasmCall,
	__registerLibFallback,
	page,
	navigating,
	swelteError,
	updated,
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
		const err = new SwelteRpcError(
			'/api',
			'login',
			404,
			{
				error: 'unknown fn',
				available: ['a', 'b'],
				hint: 'try q',
			},
			'raw'
		)
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
		await assert.rejects(
			() => __swelteFetch('/b', 'fn', 'rpc', {}),
			(e: unknown) => {
				const err = e as SwelteRpcError
				return err instanceof SwelteRpcError && err.body?.available?.[0] === 'x'
			}
		)
	})

	it('raw text fallback when body is not JSON', async () => {
		globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
		await assert.rejects(
			() => __swelteFetch('/b', 'fn', 'rpc', {}),
			(e: unknown) => {
				const err = e as SwelteRpcError
				return err instanceof SwelteRpcError && err.message.includes('boom') && err.body === null
			}
		)
	})

	it('HTML shell error hints at dist/index.html instead of bare parse failure', async () => {
		const shell = '<!doctype html><html><head></head><body><div id="app"></div></body></html>'
		globalThis.fetch = (async () => new Response(shell, { status: 200 })) as typeof fetch
		// getVerb/postForm decode on 2xx; force the error path via a 404 shell
		globalThis.fetch = (async () => new Response(shell, { status: 404 })) as typeof fetch
		await assert.rejects(
			() => __swelteFetch('/b', 'fn', 'get', {}),
			(e: unknown) => {
				const err = e as SwelteRpcError
				return err instanceof SwelteRpcError && err.message.includes('dist/index.html')
			}
		)
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

	it('SwelteResponse verbs resolve the envelope (JSON text + binary Blob)', async () => {
		let calls = 0
		globalThis.fetch = (async () => {
			calls++
			if (calls === 2)
				return new Response(new Blob(['PDF'], { type: 'application/pdf' }), {
					status: 200,
					headers: { 'content-type': 'application/pdf' },
				})
			if (calls === 3)
				return new Response(JSON.stringify('hi'), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				})
			return new Response(JSON.stringify({ id: 'sess_x' }), {
				status: 201,
				headers: { 'content-type': 'application/json' },
			})
		}) as typeof fetch
		const login = await __swelteFetch<{ status: number; body: unknown }>(
			'/api/greet',
			'login',
			'post',
			{},
			'',
			true
		)
		assert.equal(login.status, 201)
		assert.equal(JSON.parse(login.body as string).id, 'sess_x')
		const pdf = await __swelteFetch<{ status: number; body: unknown; is_bytes: boolean }>(
			'/api/greet',
			'serve_pdf',
			'get',
			{},
			'pdf',
			true
		)
		assert.equal(pdf.status, 200)
		assert.equal(pdf.is_bytes, true)
		assert.ok(pdf.body instanceof Blob)
		// value verbs are unaffected: decoded body directly
		const val = await __swelteFetch<string>('/api/greet', 'get_greeting', 'get', {}, '', false)
		assert.equal(val, 'hi')
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
					err instanceof SwelteRpcError && err.status === 0 && Array.isArray(err.body?.available)
				)
			}
		)
	})

	it('§2.11 isFail narrows fail-lite bodies, optional status', () => {
		const fail = new SwelteRpcError(
			'/b',
			'save',
			422,
			{ error: 'bad', ok: false, fieldErrors: { name: 'required' } },
			''
		)
		assert.ok(isFail(fail))
		assert.ok(isFail(fail, 422))
		assert.ok(!isFail(fail, 400))
		const plain = new SwelteRpcError('/b', 'save', 422, { error: 'bad' }, '')
		assert.ok(!isFail(plain))
		assert.ok(!isFail(new Error('x')))
		const wrongStatus = new SwelteRpcError(
			'/b',
			'save',
			200,
			{ error: 'x', ok: false, fieldErrors: {} },
			''
		)
		assert.ok(!isFail(wrongStatus))
	})

	it('§2.12 deserialize parses action envelopes', async () => {
		const r1 = await deserialize(
			new Response(JSON.stringify({ type: 'success', status: 200, data: { id: 1 } }), {
				status: 200,
			})
		)
		assert.equal(r1.type, 'success')
		const r2 = await deserialize(
			new Response(JSON.stringify({ type: 'failure', status: 422, data: { ok: false } }), {
				status: 200,
			})
		)
		assert.equal(r2.type, 'failure')
		if (r2.type === 'failure') assert.equal(r2.status, 422)
		const r3 = await deserialize(
			new Response(JSON.stringify({ type: 'redirect', status: 303, location: '/done' }), {
				status: 200,
			})
		)
		assert.equal(r3.type, 'redirect')
		await assert.rejects(() => deserialize(new Response('not json', { status: 200 })), /not JSON/)
		await assert.rejects(
			() => deserialize(new Response(JSON.stringify({ type: 'weird' }), { status: 200 })),
			/unknown type/
		)
	})

	it('§1 enhance maps raw verb JSON (envelope-first, raw fallback)', async () => {
		const env = await __swelteActionResult(
			new Response(JSON.stringify({ type: 'success', status: 200, data: { id: 1 } }), {
				status: 200,
			})
		)
		assert.equal(env.type, 'success')
		const rawOk = await __swelteActionResult(
			new Response(JSON.stringify({ ok: true }), { status: 200 })
		)
		assert.equal(rawOk.type, 'success')
		const rawFail = await __swelteActionResult(
			new Response(JSON.stringify({ error: 'bad', ok: false, fieldErrors: { name: 'required' } }), {
				status: 422,
			})
		)
		assert.equal(rawFail.type, 'failure')
		if (rawFail.type === 'failure')
			assert.ok(isFail(new SwelteRpcError('/b', 'save', 422, rawFail.data as never, '')))
	})

	it('§1 applyAction folds success/failure/redirect into stores', async () => {
		page.set({ url: '/', params: {}, route: '/' })
		await applyAction({ type: 'success', status: 200, data: { id: 7 } })
		assert.deepEqual(page.get().form, { id: 7 })
		assert.equal(navigating.get(), null)
		await applyAction({
			type: 'failure',
			status: 422,
			data: { ok: false, fieldErrors: { n: 'req' } },
		})
		assert.deepEqual((page.get().form as { ok: boolean }).ok, false)
		const g = globalThis as Record<string, unknown>
		const prev = g.__swelteRoutes
		let went = ''
		g.__swelteRoutes = {
			goto: async (u: string) => {
				went = String(u)
			},
		}
		await applyAction({ type: 'redirect', status: 303, location: '/done' })
		assert.equal(went, '/done')
		if (prev === undefined) delete g.__swelteRoutes
		else g.__swelteRoutes = prev
	})

	it('§1 enhance intercepts submit and defaults to applyAction+reset', async () => {
		let fetched = ''
		let accepted = ''
		globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
			fetched = String(url)
			accepted = init?.headers?.['accept'] ?? ''
			return new Response(JSON.stringify({ ok: true, id: 3 }), { status: 200 })
		}) as typeof fetch
		let reset = 0
		const listeners = new Map<string, (e: Event) => void>()
		const form = {
			getAttribute: (k: string) => (k === 'action' ? '/save' : k === 'method' ? 'post' : null),
			addEventListener: (t: string, fn: (e: Event) => void) => {
				listeners.set(t, fn)
			},
			removeEventListener: (t: string) => {
				listeners.delete(t)
			},
			reset: () => {
				reset++
			},
		} as unknown as HTMLFormElement
		const origFD = globalThis.FormData
		class FakeFD {
			append(): void {}
		}
		;(globalThis as Record<string, unknown>).FormData = FakeFD as unknown as typeof FormData
		try {
			const ctl = enhance(form)
			let prevented = false
			listeners.get('submit')?.({
				preventDefault: () => {
					prevented = true
				},
			} as unknown as Event)
			await new Promise((r) => setTimeout(r, 20))
			assert.equal(fetched, 'http://localhost/save')
			assert.equal(accepted, 'application/json')
			assert.ok(prevented)
			assert.equal(reset, 1)
			assert.deepEqual(page.get().form, { ok: true, id: 3 })
			ctl.destroy()
			assert.ok(!listeners.has('submit'))
		} finally {
			;(globalThis as Record<string, unknown>).FormData = origFD
		}
	})

	it('§1 enhance cancel() skips the fetch', async () => {
		let calls = 0
		globalThis.fetch = (async () => {
			calls++
			return new Response('{}', { status: 200 })
		}) as typeof fetch
		const listeners = new Map<string, (e: Event) => void>()
		const form = {
			getAttribute: () => null,
			addEventListener: (t: string, fn: (e: Event) => void) => {
				listeners.set(t, fn)
			},
			removeEventListener: (t: string) => {
				listeners.delete(t)
			},
			reset: () => {},
		} as unknown as HTMLFormElement
		const origFD = globalThis.FormData
		class FakeFD {
			append(): void {}
		}
		;(globalThis as Record<string, unknown>).FormData = FakeFD as unknown as typeof FormData
		try {
			const ctl = enhance(form, ({ cancel }) => {
				cancel()
			})
			listeners.get('submit')?.({ preventDefault: () => {} } as unknown as Event)
			await new Promise((r) => setTimeout(r, 20))
			assert.equal(calls, 0)
			ctl.destroy()
		} finally {
			;(globalThis as Record<string, unknown>).FormData = origFD
		}
	})

	it('P0 item 3: swelteError builds a status-carrying error; isRedirect narrows 3xx', () => {
		const e404 = swelteError(404, 'not found')
		assert.ok(e404 instanceof SwelteRpcError)
		assert.equal(e404.status, 404)
		assert.ok(!isRedirect(e404))
		const e303 = swelteError(303, 'see other')
		assert.ok(isRedirect(e303))
		assert.ok(isRedirect({ status: 302 }))
		assert.ok(!isRedirect({ status: 200 }))
		assert.ok(!isRedirect(new Error('x')))
	})

	it('P0 item 5: handleFetch sees and rewrites stub fetches, unregister works', async () => {
		clearFetchHooks()
		try {
			const seen: { fn: string; kind: string }[] = []
			const off = handleFetch(({ fn, kind, init }) => {
				seen.push({ fn, kind })
				const headers = new Headers(init.headers)
				headers.set('x-test-hook', '1')
				return { ...init, headers }
			})
			let gotHeader = ''
			globalThis.fetch = (async (_url: unknown, init?: { headers?: Headers }) => {
				gotHeader = init?.headers instanceof Headers ? (init.headers.get('x-test-hook') ?? '') : ''
				return new Response(JSON.stringify({ ok: true }), { status: 200 })
			}) as typeof fetch
			await __swelteFetch('/b', 'ping', 'rpc', {})
			assert.deepEqual(seen, [{ fn: 'ping', kind: 'rpc' }])
			assert.equal(gotHeader, '1')
			off()
			seen.length = 0
			await __swelteFetch('/b', 'ping2', 'rpc', {})
			assert.deepEqual(seen, [])
		} finally {
			clearFetchHooks()
		}
	})

	it('P0 item 5: handleFetch throw surfaces as the stub error', async () => {
		clearFetchHooks()
		try {
			handleFetch(() => {
				throw new Error('hook veto')
			})
			await assert.rejects(() => __swelteFetch('/b', 'ping', 'rpc', {}), /hook veto/)
		} finally {
			clearFetchHooks()
		}
	})

	it('P0 item 4: checkUpdated flips updated when the version header changes', async () => {
		updated.set(false)
		let version = 'v1'
		globalThis.fetch = (async () =>
			new Response('', { status: 200, headers: { 'x-swelte-version': version } })) as typeof fetch
		const g = globalThis as Record<string, unknown>
		const prevDoc = g.document
		g.document = { querySelector: () => null }
		try {
			assert.equal(await checkUpdated(), false)
			assert.equal(updated.get(), false)
			version = 'v2'
			assert.equal(await checkUpdated(), true)
			assert.equal(updated.get(), true)
		} finally {
			if (prevDoc === undefined) delete g.document
			else g.document = prevDoc
			updated.set(false)
		}
	})

	it('P0 item 4: checkUpdated no-ops when the server omits the version header', async () => {
		updated.set(false)
		globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch
		const g = globalThis as Record<string, unknown>
		const prevDoc = g.document
		g.document = { querySelector: () => null }
		try {
			assert.equal(await checkUpdated(), false)
			assert.equal(updated.get(), false)
		} finally {
			if (prevDoc === undefined) delete g.document
			else g.document = prevDoc
		}
	})

	it('P1 item 8: capture/restore snapshot round-trips per-key merged state', () => {
		const seen: Record<string, unknown>[] = []
		const offA = captureSnapshot(() => ({ scroll: 100 }))
		const offB = captureSnapshot(() => {
			throw new Error('never breaks navigation')
		})
		const offC = captureSnapshot(() => ({ tab: 'a' }))
		restoreSnapshot((s) => {
			seen.push(s)
		})
		const snap = __swelteCaptureSnapshot()
		assert.deepEqual(snap, { scroll: 100, tab: 'a' })
		__swelteRestoreSnapshot({ scroll: 5 })
		assert.deepEqual(seen, [{ scroll: 5 }])
		offA()
		offB()
		offC()
		assert.deepEqual(__swelteCaptureSnapshot(), {})
	})
})
