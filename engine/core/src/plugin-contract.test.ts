// §1 plugin contract tests: declaration fan-out, generate ownership and
// lifecycle ordering (registration init, reverse cleanup) + app startup hook.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { renderHarness } from './gen/config.js'
import { parseStructs, parseVFile } from './vite/parse.js'
import {
	assertPluginName,
	collectPluginDeclarations,
	dedupPlugins,
	writePluginOutputs,
} from './vite/plugins.js'
import type { SweltePlugin, SweltePluginDeclaration } from './vite/types.js'

function declSources() {
	return {
		app: {
			file: 'src/app.v',
			modulePath: 'app',
			source: "module app\n@[cron('60s')]\npub fn tick() {}\n",
		},
		routes: [
			{
				file: 'src/routes/api/rooms.v',
				modulePath: 'api/rooms',
				source:
					'module api_rooms\n@[cron(\'60s\')]\npub fn tick() {}\n@[get]\npub fn list() string { return "" }\n',
			},
		],
		libs: [
			{
				kind: 'backend' as const,
				file: 'src/lib/backend/jobs.v',
				modulePath: 'backend/jobs',
				source:
					"module jobs\npub struct Job {\n\tname string\n}\n@[note('x')]\npub fn helper() {}\n",
			},
			{
				kind: 'lib' as const,
				file: 'src/lib/text.v',
				modulePath: 'text',
				source: "module text\n@[note('y')]\npub fn helper() {}\n",
			},
		],
	}
}

describe('§1 plugin declarations', () => {
	it('fans claimed declarations out with source, structs, module and location', () => {
		const note: SweltePlugin = { name: 'note', attrs: ['note'] }
		const cron: SweltePlugin = { name: 'jobs', attrs: ['cron'] }
		const claims = collectPluginDeclarations([note, cron], declSources(), parseVFile, parseStructs)
		const crons = claims.get('jobs') ?? []
		assert.equal(crons.length, 2)
		assert.deepEqual(
			crons.map((d) => [d.kind, d.file, d.modulePath, d.line]),
			[
				['app', 'src/app.v', 'app', 2],
				['route', 'src/routes/api/rooms.v', 'api/rooms', 2],
			]
		)
		assert.equal(crons[0].fn.line, 2, 'RpcFn carries the attribute line')
		for (const d of crons) assert.ok(d.source.includes('@[cron'), 'keeps raw source')
		const notes = claims.get('note') ?? []
		assert.equal(notes.length, 2)
		assert.deepEqual(
			notes.map((d) => [d.kind, d.file]),
			[
				['backend', 'src/lib/backend/jobs.v'],
				['lib', 'src/lib/text.v'],
			]
		)
		const backendNote = notes.find((d) => d.kind === 'backend') as SweltePluginDeclaration
		assert.deepEqual(
			backendNote.structs.map((s) => s.name),
			['Job']
		)
		assert.ok(backendNote.source.includes('pub struct Job'), 'keeps source with structs')
	})

	it('dedups by plugin name (first wins) for consistent dev/check/build/CLI resolution', () => {
		const a: SweltePlugin = { name: 'jobs', attrs: ['cron'] }
		const b: SweltePlugin = { name: 'jobs', attrs: ['note'] }
		assert.deepEqual(
			dedupPlugins([a, b]).map((p) => p.attrs),
			[['cron']]
		)
	})
})

describe('§1 plugin generate ownership', () => {
	it('emits named files and prunes stale output on regeneration or removal', () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-plugin-gen-'))
		try {
			const genAbs = join(root, '.swelte')
			mkdirSync(genAbs, { recursive: true })
			const ctxFor = () => ({
				dirs: { routesDir: 'src/routes', libDir: 'src/lib', outDir: '.swelte' },
				declarations: [],
				config: undefined,
			})
			const reserved = new Set(['routes', 'generated', 'types', 'app', 'dev'])
			const cli: SweltePlugin = {
				name: 'cliplug',
				attrs: [],
				generate: () => ({ 'cmd.mjs': 'export {}\n', 'nested/help.txt': 'hi\n' }),
			}
			writePluginOutputs(genAbs, [cli], ctxFor, reserved)
			assert.ok(readFileSync(join(genAbs, 'cliplug', 'cmd.mjs'), 'utf8').includes('export'))
			writePluginOutputs(
				genAbs,
				[{ ...cli, generate: () => ({ 'cmd.mjs': 'export {}\n' }) }],
				ctxFor,
				reserved
			)
			assert.equal(existsSync(join(genAbs, 'cliplug', 'nested', 'help.txt')), false)
			writePluginOutputs(genAbs, [], ctxFor, reserved)
			assert.equal(existsSync(join(genAbs, 'cliplug')), false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('rejects core-dir collisions', () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-plugin-collide-'))
		try {
			const genAbs = join(root, '.swelte')
			mkdirSync(genAbs, { recursive: true })
			const bad: SweltePlugin = { name: 'routes', attrs: [], generate: () => ({ 'x.mjs': '' }) }
			assert.throws(
				() =>
					writePluginOutputs(
						genAbs,
						[bad],
						() => ({
							dirs: { routesDir: 'r', libDir: 'l', outDir: 'o' },
							declarations: [],
							config: undefined,
						}),
						new Set(['routes'])
					),
				/collides with a core dir/
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe('§1 review fixes (1–4)', () => {
	it('rejects unsafe plugin names before any output or cleanup', () => {
		for (const bad of ['../escaped', 'a/b', '..', '', '.hidden', 'has space', 'semi;colon']) {
			assert.throws(() => assertPluginName(bad), /safe name/, `rejects ${bad}`)
			assert.throws(
				() => dedupPlugins([{ name: bad, attrs: [] }]),
				/safe name/,
				`dedup rejects ${bad}`
			)
		}
		// Path escape end-to-end: must throw, must not write outside .swelte/.
		const root = mkdtempSync(join(tmpdir(), 'swelte-plugin-escape-'))
		try {
			const genAbs = join(root, '.swelte')
			mkdirSync(genAbs, { recursive: true })
			const evil = {
				name: '../escaped',
				attrs: [],
				generate: () => ({ 'pwn.txt': 'x' }),
			} as unknown as SweltePlugin
			assert.throws(
				() =>
					writePluginOutputs(
						genAbs,
						[evil],
						() => ({
							dirs: { routesDir: 'r', libDir: 'l', outDir: 'o' },
							declarations: [],
							config: undefined,
						}),
						new Set()
					),
				/safe name/
			)
			assert.equal(existsSync(join(root, 'escaped', 'pwn.txt')), false)
			assert.equal(existsSync(join(root, 'pwn.txt')), false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('dedup rejects malformed entries instead of silently dropping', () => {
		assert.throws(() => dedupPlugins([null as never]), /must be an object/)
		assert.throws(() => dedupPlugins([{ attrs: [] } as never]), /safe name/)
	})

	it('resolveCommands rejects command-only providers loudly', async () => {
		const { resolveCommands } = await import('./cli.js')
		assert.throws(
			() => resolveCommands([{ cli: [{ name: 'x', summary: 'y', run: () => {} }] }]),
			/safe name|command provider/
		)
		assert.throws(
			() => resolveCommands([{ name: 'ok', cli: [{ name: '', summary: '', run: null }] } as never]),
			/needs a (name|summary|run)/
		)
		const cmds = resolveCommands([
			{ name: 'good', cli: [{ name: 'hello', summary: 'hi', run: () => {} }] },
		])
		assert.ok(
			cmds.some((c) => c.name === 'hello'),
			'named provider registers'
		)
	})

	it('swelte check reports plugin validate/generate failures read-only', async () => {
		const {
			mkdtempSync: mk,
			mkdirSync: mkd,
			writeFileSync: wfs,
			existsSync: ex,
		} = await import('node:fs')
		const root = mk(join(tmpdir(), 'swelte-check-plugins-'))
		try {
			mkd(join(root, 'src', 'routes'), { recursive: true })
			wfs(join(root, 'package.json'), '{"name":"t","type":"module"}')
			wfs(join(root, 'svelte.config.js'), 'export default {}')
			wfs(join(root, 'src', 'app.v'), "module app\n@[boom('x')]\npub fn bad() {}\n")
			const { collectDiagnostics } = await import('./gen/diagnostics.js')
			// No plugins configured: check passes with no plugin diagnostics.
			let diags = await collectDiagnostics(root)
			assert.ok(!diags.some((d) => d.kind.startsWith('plugin-')), 'no plugin diags without plugins')
			// NOTE: configured plugins come from vite.config.ts's swelte.plugins,
			// which the CLI never imports; collectPluginDiagnostics is exercised
			// directly with the same resolution the CLI uses (deduped).
			const { collectPluginDiagnostics } = await import('./gen/diagnostics.js')
			const failing: SweltePlugin = {
				name: 'failer',
				attrs: ['boom'],
				validate: () => {
					throw new Error('[swelte] boom is bad')
				},
				generate: () => {
					throw new Error('[swelte] gen blew up')
				},
				cli: [{ name: 'bad', summary: '', run: () => {} }] as never,
			}
			diags = await collectPluginDiagnostics(root, [failing], {
				routesDir: 'src/routes',
				libDir: 'src/lib',
			})
			const kinds = diags.map((d) => d.kind).sort()
			assert.ok(kinds.includes('plugin-validate'), `validate failure reported (got ${kinds})`)
			assert.ok(kinds.includes('plugin-generate'), `generate failure reported (got ${kinds})`)
			assert.ok(kinds.includes('plugin-cli'), `cli shape failure reported (got ${kinds})`)
			const vdiag = diags.find((d) => d.kind === 'plugin-validate')
			assert.equal(vdiag?.file, 'src/app.v', 'validate diag points at the file')
			assert.equal(vdiag?.line, 2, 'validate diag carries the attribute line')
			// Read-only: nothing written under .swelte/.
			assert.equal(ex(join(root, '.swelte')), false, 'check writes nothing')
		} finally {
			const { rmSync: rm } = await import('node:fs')
			rm(root, { recursive: true, force: true })
		}
	})
})

describe('§1 lifecycle ordering vs the app startup hook', () => {
	it('starts plugins in registration order and shuts down in reverse after @[startup]', async () => {
		const { loadConfig } = await import('./gen/config.js')
		const cfg = await loadConfig(mkdtempSync(join(tmpdir(), 'swelte-plugin-order-')))
		const source = renderHarness(
			cfg,
			import.meta.url,
			{ startupBody: "println('app-start')", shutdownBody: "println('app-stop')" },
			[
				{ mainInner: "\tprintln('first-start')" },
				{ mainInner: "\tprintln('second-start')" },
				{ shutdown: "println('second-stop')" },
				{ shutdown: "println('first-stop')" },
			]
		)
		// Startup: @[startup] body first, then plugins registration-ordered.
		const startOrder = ['app-start', 'first-start', 'second-start'].map((s) => source.indexOf(s))
		assert.ok(
			startOrder.every((i) => i >= 0),
			'startup calls emitted'
		)
		assert.deepEqual(
			[...startOrder].sort((a, b) => a - b),
			startOrder,
			'registration init order'
		)
		// Cleanup: plugin shutdown fragments (LIFO) run before the app
		// @[shutdown] body inside swelte_app_shutdown.
		const stopOrder = ['second-stop', 'first-stop', 'app-stop'].map((s) => source.indexOf(s))
		assert.ok(
			stopOrder.every((i) => i >= 0),
			'shutdown calls emitted'
		)
		assert.deepEqual(
			[...stopOrder].sort((a, b) => a - b),
			stopOrder,
			'reverse cleanup order'
		)
		assert.ok(
			source.indexOf('swelte_app_shutdown') < source.indexOf('first-start'),
			'shutdown hook section precedes main (cleanup runs at shutdown)'
		)
	})
})
