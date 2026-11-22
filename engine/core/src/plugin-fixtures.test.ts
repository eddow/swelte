// §1 end-to-end: two fixture plugins + an application startup hook.
// Verifies declaration access, generate outputs, init order vs startup,
// reverse cleanup and failure behavior through the real generate().
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { SweltePlugin } from './vite/types.js'

function scaffold(): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-fixtures-'))
	mkdirSync(join(root, 'src', 'routes', 'api'), { recursive: true })
	mkdirSync(join(root, 'src', 'lib'), { recursive: true })
	writeFileSync(join(root, 'package.json'), '{"name":"t","type":"module"}')
	writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
	return root
}

async function generate(root: string, plugins: SweltePlugin[]): Promise<void> {
	const { swelte } = await import('./vite.js')
	const plug = swelte({ plugins }) as unknown as {
		configResolved?: (c: { root: string }) => void
		buildStart?: () => Promise<void>
	}
	plug.configResolved?.({ root })
	await plug.buildStart?.()
}

describe('§1 two fixture plugins + app startup hook', () => {
	it('initializes registration-ordered after @[startup] and cleans up reversed', async () => {
		const root = scaffold()
		try {
			writeFileSync(
				join(root, 'src', 'app.v'),
				"module app\n@[startup]\npub fn boot() {\n\tprintln('app-boot')\n}\n@[shutdown]\npub fn down() {\n\tprintln('app-down')\n}\n"
			)
			writeFileSync(
				join(root, 'src', 'routes', 'api', 'ping.v'),
				'module api_ping\n@[get]\npub fn ping() string {\n\treturn "pong"\n}\n'
			)
			const mk = (name: string): SweltePlugin => ({
				name,
				attrs: [],
				harness: () => ({
					mainInner: `\tprintln('${name}-start')`,
					shutdown: `println('${name}-stop')`,
				}),
				generate: () => ({ 'out.txt': `${name}\n` }),
			})
			await generate(root, [mk('first'), mk('second')])
			const server = readFileSync(join(root, '.swelte', 'server.v'), 'utf8')
			for (const marker of [
				'app-boot',
				'first-start',
				'second-start',
				'second-stop',
				'first-stop',
				'app-down',
			])
				assert.ok(server.includes(marker), `harness contains ${marker}`)
			assert.ok(
				server.indexOf('app-boot') < server.indexOf('first-start') &&
					server.indexOf('first-start') < server.indexOf('second-start'),
				'startup precedes plugin init in registration order'
			)
			assert.ok(
				server.indexOf('second-stop') < server.indexOf('first-stop') &&
					server.indexOf('first-stop') < server.indexOf('app-down'),
				'reverse cleanup precedes app shutdown'
			)
			assert.equal(readFileSync(join(root, '.swelte', 'first', 'out.txt'), 'utf8'), 'first\n')
			assert.equal(readFileSync(join(root, '.swelte', 'second', 'out.txt'), 'utf8'), 'second\n')
			await generate(root, [mk('first')])
			assert.equal(existsSync(join(root, '.swelte', 'second')), false)
			assert.ok(existsSync(join(root, '.swelte', 'first', 'out.txt')))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('rejects colliding generate outputs', async () => {
		const root = scaffold()
		try {
			writeFileSync(join(root, 'src', 'app.v'), 'module app\n')
			const clash: SweltePlugin = { name: 'routes', attrs: [], generate: () => ({ 'y.txt': 'b' }) }
			await assert.rejects(() => generate(root, [clash]), /collides with a core dir/)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('passes claimed declarations with source, structs, module and location', async () => {
		const root = scaffold()
		try {
			writeFileSync(
				join(root, 'src', 'app.v'),
				"module app\npub struct Cfg {\n\tflag bool\n}\n@[tick('60s')]\npub fn every() {}\n"
			)
			writeFileSync(
				join(root, 'src', 'lib', 'jobs.v'),
				"module jobs\npub struct Job {\n\tname string\n}\n@[tick('60s')]\npub fn helper() {}\n"
			)
			let got: { file: string; modulePath: string; kind: string; structs: string[] }[] = []
			const probe: SweltePlugin = {
				name: 'ticker',
				attrs: ['tick'],
				validate: (_rel, _fn, decl) => {
					assert.ok(decl?.source.includes('@[tick'), 'validate sees source')
				},
				generate: (ctx) => {
					got = ctx.declarations.map((d) => ({
						file: d.file,
						modulePath: d.modulePath,
						kind: d.kind,
						structs: d.structs.map((s) => s.name),
					}))
					return {}
				},
			}
			await generate(root, [probe])
			assert.deepEqual(got, [
				{ file: 'src/app.v', modulePath: 'app', kind: 'app', structs: ['Cfg'] },
				{ file: 'src/lib/jobs.v', modulePath: 'jobs', kind: 'lib', structs: ['Job'] },
			])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
