import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { writeTargetShim } from './build.js'
import { runExport } from './export.js'

describe('sveltekit remainder: export snapshot + target shims', () => {
	it('export reuses entries.json + dist html + contract', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-export-'))
		try {
			mkdirSync(join(root, '.swelte'), { recursive: true })
			writeFileSync(
				join(root, '.swelte', 'entries.json'),
				JSON.stringify({ mode: 'static', routes: ['/', '/about'], dynamics: [], expanded: [] })
			)
			mkdirSync(join(root, 'dist', 'about'), { recursive: true })
			writeFileSync(join(root, 'dist', 'index.html'), '<html>shell</html>')
			writeFileSync(join(root, 'dist', 'about', 'index.html'), '<html>about</html>')
			writeFileSync(join(root, 'swelte.contract.json'), '{}')
			const logs: string[] = []
			await runExport({
				argv: [],
				opts: { root, out: join(root, 'snapshot') },
				rest: [],
				log: (m) => logs.push(m),
				error: () => {},
			})
			const summary = JSON.parse(readFileSync(join(root, 'snapshot', 'snapshot.json'), 'utf8')) as {
				pages: string[]
			}
			assert.deepEqual(summary.pages, ['about/index.html', 'index.html'])
			assert.ok(existsSync(join(root, 'snapshot', 'entries.json')))
			assert.ok(existsSync(join(root, 'snapshot', 'pages', 'about', 'index.html')))
			assert.ok(existsSync(join(root, 'snapshot', 'swelte.contract.json')))
			assert.ok(logs.join('\n').includes('2 pages'))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('export throws without entries.json', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-export-'))
		try {
			await assert.rejects(
				() => runExport({ argv: [], opts: { root }, rest: [], log: () => {}, error: () => {} }),
				/entries\.json/
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('target shims are packaging-only', () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-target-'))
		try {
			mkdirSync(join(root, 'dist'), { recursive: true })
			const logs: string[] = []
			const log = (m: string) => logs.push(m)
			writeTargetShim(root, 'dist', 'auto', {}, log)
			assert.ok(!existsSync(join(root, 'dist', '.swelte-static')))
			writeTargetShim(root, 'dist', 'static', {}, log)
			assert.ok(existsSync(join(root, 'dist', '.swelte-static')))
			writeTargetShim(root, 'dist', 'node', {}, log)
			assert.ok(
				readFileSync(join(root, 'dist', 'Dockerfile.swelte'), 'utf8').includes('./dist/server')
			)
			writeTargetShim(root, 'dist', 'edge', { '/blog': '60' }, log)
			const headers = readFileSync(join(root, 'dist', '_headers'), 'utf8')
			assert.ok(headers.includes('/blog/*'))
			assert.ok(headers.includes('s-maxage=60'))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
