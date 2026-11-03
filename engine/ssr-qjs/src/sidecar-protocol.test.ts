import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startSsrDevServer } from './dev.js'

async function freePort(): Promise<number> {
	const { createServer } = await import('node:http')
	return new Promise((resolve, reject) => {
		const s = createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const addr = s.address()
			const port = typeof addr === 'object' && addr ? addr.port : 0
			s.close(() => resolve(port))
		})
	})
}

async function post(
	port: number,
	body: unknown,
	headers: Record<string, string> = {}
): Promise<{ status: number; json: unknown; text: string }> {
	const raw = typeof body === 'string' ? body : JSON.stringify(body)
	const res = await fetch(`http://127.0.0.1:${port}/`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: raw,
	})
	const text = await res.text()
	let json: unknown = null
	try {
		json = JSON.parse(text)
	} catch {
		/* non-JSON */
	}
	return { status: res.status, json, text }
}

describe('item 21 — sidecar protocol (real loopback)', () => {
	let root = ''
	let renderFile = ''
	let port = 0
	let server: { url: string; close(): Promise<void> } | null = null

	before(async () => {
		root = mkdtempSync(join(tmpdir(), 'swelte-sidecar-'))
		renderFile = join(root, 'render.js')
		writeFileSync(
			renderFile,
			`export function renderRoute(route, props_json) { const p = JSON.parse(props_json || '{}'); return { head: '<title>t</title>', body: '<h1>' + route + ':' + (p.n ?? 0) + '</h1>' }; }\n`
		)
		port = await freePort()
		server = await startSsrDevServer({ root, renderFile, port })
	})

	after(async () => {
		await server?.close()
	})

	it('POST / renders { html, head }', async () => {
		const { status, json } = await post(port, { route: '/', props: { n: 3 } })
		assert.equal(status, 200)
		assert.ok((json as { html: string }).html.includes('/'))
		assert.ok((json as { head: string }).head.includes('<title>'))
	})

	it('bad JSON → 400; body > 1MB → 413', async () => {
		const bad = await post(port, '{not json')
		assert.equal(bad.status, 400)
		const big = await post(port, 'x'.repeat(1024 * 1024 + 8), { 'content-type': 'text/plain' })
		assert.equal(big.status, 413)
	})

	it('wrong method/path → 404 and server stays up', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
		assert.equal(res.status, 404)
		await res.text()
		// Still healthy after the 404.
		const { status } = await post(port, { route: '/', props: {} })
		assert.equal(status, 200)
	})

	it('missing render file → 503', async () => {
		const p2 = await freePort()
		const s2 = await startSsrDevServer({ root, renderFile: join(root, 'nope.js'), port: p2 })
		try {
			const { status, json } = await post(p2, { route: '/', props: {} })
			assert.equal(status, 503)
			assert.ok(String((json as { error: string }).error).includes('no renderer'))
		} finally {
			await s2.close()
		}
	})

	it('render timeout → 500; throw in render → 500 JSON, server survives', async () => {
		const slowFile = join(root, 'slow.js')
		writeFileSync(slowFile, `export function renderRoute() { return new Promise(() => {}); }\n`)
		const p2 = await freePort()
		const s2 = await startSsrDevServer({
			root,
			renderFile: slowFile,
			port: p2,
			renderTimeoutMs: 50,
		})
		try {
			const { status } = await post(p2, { route: '/', props: {} })
			assert.equal(status, 500)
			// Server still answers afterwards.
			const { status: s } = await post(p2, { route: '/', props: {} })
			assert.equal(s, 500)
		} finally {
			await s2.close()
		}

		const throwFile = join(root, 'throw.js')
		writeFileSync(throwFile, `export function renderRoute() { throw new Error('boom'); }\n`)
		const p3 = await freePort()
		const s3 = await startSsrDevServer({ root, renderFile: throwFile, port: p3 })
		try {
			const { status, json } = await post(p3, { route: '/', props: {} })
			assert.equal(status, 500)
			assert.ok(String((json as { error: string }).error).includes('boom'))
		} finally {
			await s3.close()
		}
	})
})
