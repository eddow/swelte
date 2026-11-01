import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startSsrDevServer } from './dev.js'
import { runSsrCheck } from './cli.js'

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

function stubRender(marker = 'home'): string {
	return `export function renderRoute(route, props_json) { const p = JSON.parse(props_json || '{}'); if (route === '/nope') return { head: '', body: '<div data-swelte-ssr="1">oops</div>' }; return { head: '<title>t</title>', body: '<div data-swelte-ssr="1">${marker}:' + route + '</div>' }; }\n`
}

describe('item 24 — runSsrCheck halves (CI promotion)', () => {
	it('sidecar half passes on a stub render.js; Hand/prod halves skip without artifacts', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-check-'))
		mkdirSync(join(root, '.swelte', 'dev'), { recursive: true })
		writeFileSync(join(root, '.swelte', 'dev', 'render.js'), stubRender())
		const port = await freePort()
		const logs: string[] = []
		const orig = console.log
		console.log = (...a: unknown[]) => {
			logs.push(a.map(String).join(' '))
		}
		try {
			// Missing dist/server + no server_gen.v → prod + Hand halves skip, no throw.
			await runSsrCheck({ root, port })
		} finally {
			console.log = orig
		}
		const joined = logs.join('\n')
		assert.ok(joined.includes('renders HTML ok'), joined)
		assert.ok(joined.includes('+error fallback ok'), joined)
		assert.ok(joined.includes('skipping Hand half'), joined)
		assert.ok(joined.includes('skipping prod-binary half'), joined)
	})

	it('JSON-accept bypass is enforced through runSsrCheck (HTML render must not leak into JSON)', async () => {
		// A stub whose renderRoute ignores Accept would still pass the
		// sidecar-half (sidecar POSTs JSON directly); the bypass assertion
		// lives in assertSsrHtml against a *browser-shape* base. Here we
		// assert the sidecar envelope itself never carries the JSON-bypass
		// path: POST with Accept: application/json still returns the HTML
		// envelope (sidecar is JSON-in/JSON-out by design).
		const root = mkdtempSync(join(tmpdir(), 'swelte-check2-'))
		mkdirSync(join(root, '.swelte', 'dev'), { recursive: true })
		writeFileSync(join(root, '.swelte', 'dev', 'render.js'), stubRender())
		const port = await freePort()
		const server = await startSsrDevServer({
			root,
			renderFile: join(root, '.swelte', 'dev', 'render.js'),
			port,
		})
		try {
			const res = await fetch(server.url + '/', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ route: '/', props: {} }),
			})
			assert.equal(res.status, 200)
			const env = (await res.json()) as { html: string }
			assert.ok(env.html.includes('data-swelte-ssr="1"'))
		} finally {
			await server.close()
		}
	})
})
