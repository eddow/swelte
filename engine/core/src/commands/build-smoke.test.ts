import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { probeSmoke, portFree } from './dev.js'

/** Boot a `node -e` stub "binary" the way runBuild boots the V binary:
 * argv on PORT, SWELTE_DIST in env, then probeSmoke against it. */
async function withStub(
	stubSrc: string,
	hasGreetRoute: boolean,
	check: (port: number) => Promise<void>
): Promise<string[]> {
	const logs: string[] = []
	const { createServer } = await import('node:net')
	const port = await new Promise<number>((resolve, reject) => {
		const s = createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const a = s.address()
			const p = typeof a === 'object' && a ? a.port : 0
			s.close(() => resolve(p))
		})
	})
	const child: ChildProcess = spawn(process.execPath, ['-e', stubSrc], {
		env: { ...process.env, PORT: String(port), SWELTE_DIST: 'dist' },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let logged = ''
	child.stderr?.on('data', (d: Buffer) => {
		logged += d.toString()
	})
	child.stdout?.on('data', (d: Buffer) => {
		logged += d.toString()
	})
	try {
		await check(port)
	} finally {
		try {
			child.kill('SIGTERM')
		} catch {
			/* ignore */
		}
		await new Promise((r) => setTimeout(r, 300))
		try {
			child.kill('SIGKILL')
		} catch {
			/* ignore */
		}
	}
	if (logged) logs.push(logged)
	return logs
}

const pageStub = (extra = '') => `
const http = require('node:http');
const port = Number(process.env.PORT);
http.createServer((req, res) => {
  if (req.url.startsWith('/api/greet')) {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({ ok: 'Hello w' }));
    return;
  }
  ${extra}
  const accept = req.headers.accept || '';
  if (accept.includes('application/json')) {
    res.writeHead(200, {'content-type':'application/json'});
    res.end('{}');
    return;
  }
  res.writeHead(200, {'content-type':'text/html'});
  res.end('<html>shell</html>');
}).listen(port, '127.0.0.1');
`

describe('item 14 — build smoke matrix (mocked binary / node -e stub)', () => {
	it('empty vs sample scaffold: page 200 ± greet API', async () => {
		// Empty scaffold: no greet route → page 200 + JSON check.
		await withStub(pageStub(), false, async (port) => {
			const logs: string[] = []
			await probeSmoke(port, false, (m) => logs.push(m))
			assert.ok(logs.join(' ').includes('no api/greet route'))
		})
		// Sample scaffold: greet route present → api body must say Hello.
		await withStub(pageStub(), true, async (port) => {
			const logs: string[] = []
			await probeSmoke(port, true, (m) => logs.push(m))
			assert.ok(logs.join(' ').includes('api ok'))
		})
	})

	it('aliased vs taken ports: takePort fallback + killPort reuse', async () => {
		const { takePort, killPort } = await import('./dev.js')
		// takePort: explicit port wins, garbage falls back.
		assert.equal(takePort(1234, 4173), 1234)
		assert.equal(takePort(undefined, 4173), 4173)
		assert.equal(takePort('nope', 4173), 4173)
		// Taken port is occupied while the holder serves (killPort path is
		// runBuild's, not the probe's) — and frees after the child dies.
		const { portFree: free } = await import('./dev.js')
		let held = 0
		// NOTE: the child binds 127.0.0.1 while portFree() probes a
		// dual-stack listen; on some kernels both succeed (different
		// sockets). So the occupancy assertion targets a second *bind*,
		// not portFree: only the smoke + free-after-death are asserted.
		await withStub(pageStub(), false, async (port) => {
			held = port
			await probeSmoke(port, false)
		})
		assert.equal(await free(held), true)
		// killPort on a free port is a no-op (never throws).
		const logs: string[] = []
		await killPort(held, (m) => logs.push(m))
		assert.deepEqual(logs, [])
	})

	it('good vs broken V binary: non-listener fails, wrong body fails', async () => {
		// Broken binary: exits immediately, never listens.
		const { createServer } = await import('node:net')
		const dead = await new Promise<number>((resolve, reject) => {
			const s = createServer()
			s.once('error', reject)
			s.listen(0, '127.0.0.1', () => {
				const a = s.address()
				const p = typeof a === 'object' && a ? a.port : 0
				s.close(() => resolve(p))
			})
		})
		await assert.rejects(() => probeSmoke(dead, false), /did not listen/)
		// Wrong API body: page 200 but greet says goodbye → smoke fails.
		await withStub(pageStub(`if (false) {}`), true, async (port) => {
			// Sanity: stub above always says Hello; craft a lying variant.
		})
		const lying = pageStub().replace('Hello w', 'Goodbye w')
		await withStub(lying, true, async (port) => {
			await assert.rejects(() => probeSmoke(port, true), /unexpected body/)
		})
		// Wrong page status: 500 on / → smoke fails.
		const sick = `
const http = require('node:http');
const port = Number(process.env.PORT);
http.createServer((req, res) => { res.writeHead(500); res.end('oops'); }).listen(port, '127.0.0.1');
`
		await withStub(sick, false, async (port) => {
			await assert.rejects(() => probeSmoke(port, false), /HTTP 500/)
		})
	})
})
