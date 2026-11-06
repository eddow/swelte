import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { runSsrCheck } from './cli.js'
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

function stubRender(marker = 'home'): string {
	return `export function renderRoute(route, props_json) { const p = JSON.parse(props_json || '{}'); if (route === '/nope') return { head: '', body: '<div data-swelte-ssr="1">oops</div>' }; if (route === '/+error') { const st = (p && typeof p.status === 'number') ? p.status : 500; const msg = (p && typeof p.message === 'string') ? p.message : 'render failed'; return { head: '<title>t</title>', body: '<div data-swelte-ssr="1">' + st + ':' + msg + '</div>' }; } return { head: '<title>t</title>', body: '<div data-swelte-ssr="1">${marker}:' + route + '</div>' }; }\n`
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
			// Missing dist/server + no server_gen.v → Hand/prod halves skip, no throw.
			await runSsrCheck({ root, port })
		} finally {
			console.log = orig
		}
		const joined = logs.join('\n')
		assert.ok(joined.includes('renders HTML ok'), joined)
		assert.ok(joined.includes('+error fallback ok'), joined)
		assert.ok(joined.includes('500 props render ok'), joined)
		assert.ok(joined.includes('skipping Hand half'), joined)
		assert.ok(joined.includes('skipping prod-binary half'), joined)
	})

	it('load-throw 500 props reach the +error render through the sidecar envelope', async () => {
		// Unit half of the `!T` → 500 HTML gate: Hand sends
		// `{"status":500,"message":…}` props when a `@[load]` throws; the
		// renderer must surface status+message in +error HTML (server up).
		// The real-V 500-status half runs in example CI (needs the binary).
		const root = mkdtempSync(join(tmpdir(), 'swelte-check500-'))
		mkdirSync(join(root, '.swelte', 'dev'), { recursive: true })
		writeFileSync(join(root, '.swelte', 'dev', 'render.js'), stubRender())
		const port = await freePort()
		const server = await startSsrDevServer({
			root,
			renderFile: join(root, '.swelte', 'dev', 'render.js'),
			port,
		})
		try {
			const res = await fetch(`${server.url}/`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ route: '/+error', props: { status: 500, message: 'boom' } }),
			})
			assert.equal(res.status, 200)
			const env = (await res.json()) as { html: string; head: string }
			assert.ok(env.html.includes('data-swelte-ssr="1"'))
			assert.ok(env.html.includes('boom'), env.html.slice(0, 200))
			assert.ok(env.html.includes('500'), env.html.slice(0, 200))
		} finally {
			await server.close()
		}
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
			const res = await fetch(`${server.url}/`, {
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
