import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { startSsrDevServer } from './dev.js'

async function freePort(): Promise<number> {
	const { createServer } = await import('node:net')
	return new Promise((resolve, reject) => {
		const s = createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const addr = s.address()
			const p = typeof addr === 'object' && addr ? addr.port : 0
			s.close(() => resolve(p))
		})
	})
}

async function render(port: number, route: string): Promise<string> {
	const res = await fetch(`http://127.0.0.1:${port}/`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ route, props: {} }),
	})
	const env = (await res.json()) as { html: string }
	assert.equal(res.status, 200)
	return env.html
}

describe('item 26 — HMR no-restart proof (mtime re-import)', () => {
	it('touching render.js swaps output without restarting the server', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-hmr-'))
		const renderFile = join(root, 'render.js')
		writeFileSync(
			renderFile,
			`export function renderRoute(route, props_json) { return { head: '', body: '<div data-swelte-ssr="1">v1</div>' }; }\n`
		)
		const port = await freePort()
		// HMR trigger: the dev watcher keys on renderFile mtime, so the
		// server under test must read through renderFileFor-style mtime
		// re-import (load() compares statSync mtimeMs per request).
		const server = await startSsrDevServer({ root, renderFile, port })
		try {
			assert.ok((await render(port, '/')).includes('v1'))
			// Ensure the mtime actually advances past the cached value.
			await new Promise((r) => setTimeout(r, 25))
			writeFileSync(
				renderFile,
				`export function renderRoute(route, props_json) { return { head: '', body: '<div data-swelte-ssr="1">v2</div>' }; }\n`
			)
			const deadline = Date.now() + 5000
			let html = ''
			for (;;) {
				html = await render(port, '/')
				if (html.includes('v2')) break
				if (Date.now() > deadline) break
				await new Promise((r) => setTimeout(r, 50))
			}
			assert.ok(html.includes('v2'), html.slice(0, 120))
			// Second render is stable (no crash, no stale v1).
			assert.ok((await render(port, '/')).includes('v2'))
		} finally {
			await server.close()
		}
	})
})
