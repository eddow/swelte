import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig, renderHarness } from './gen/config.js'
import { stageBackendModules } from './vite/backend.js'
import { loadServerHooks } from './vite/hooks.js'

test('native backend staging preserves modules, excludes universal code and removes only owned stale files', () => {
	const root = mkdtempSync(join(tmpdir(), 'swelte-backend-'))
	try {
		const lib = join(root, 'lib')
		const output = join(root, 'generated')
		mkdirSync(join(lib, 'backend', 'nested'), { recursive: true })
		mkdirSync(join(output, 'backend'), { recursive: true })
		writeFileSync(
			join(lib, 'backend', 'database.v'),
			'module backend\npub fn ready() bool { return true }'
		)
		writeFileSync(join(lib, 'backend', 'nested', 'connection.v'), 'module nested')
		writeFileSync(join(lib, 'text.v'), 'module text')
		writeFileSync(join(output, 'backend', 'plugin.v'), 'module backend')
		assert.deepEqual(stageBackendModules(lib, output, new Set(['backend/plugin.v'])), ['backend'])
		assert.match(readFileSync(join(output, 'backend', 'database.v'), 'utf8'), /ready/)
		assert.ok(existsSync(join(output, 'backend', 'nested', 'connection.v')))
		assert.ok(!existsSync(join(output, 'text.v')))
		rmSync(join(lib, 'backend', 'database.v'))
		stageBackendModules(lib, output, new Set(['backend/plugin.v']))
		assert.ok(!existsSync(join(output, 'backend', 'database.v')))
		assert.ok(existsSync(join(output, 'backend', 'plugin.v')))
		assert.throws(
			() => stageBackendModules(lib, output, new Set(['backend/nested/connection.v'])),
			/collides/
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('app startup preserves native imports for generated harness code', () => {
	const root = mkdtempSync(join(tmpdir(), 'swelte-startup-'))
	try {
		mkdirSync(join(root, 'src'))
		writeFileSync(
			join(root, 'src/app.v'),
			'module app\nimport backend\nimport os\n@[startup]\npub fn start() ! {\n backend.initialize()!\n os.setenv("READY", "1", true)\n}\n'
		)
		const hooks = loadServerHooks(root)
		assert.equal(hooks.imports, 'import backend\nimport os')
		assert.match(hooks.startupBody!, /backend.initialize/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('startup errors stay in a fallible function and plugin jobs start afterward', async () => {
	const root = mkdtempSync(join(tmpdir(), 'swelte-start-order-'))
	try {
		const source = renderHarness(
			await loadConfig(root),
			import.meta.url,
			{
				startupBody: "return error('database unavailable')",
				shutdownBody: "println('pool-close')",
			},
			[{ mainInner: "\tprintln('jobs-start')" }]
		)
		assert.ok(source.indexOf('database unavailable') < source.indexOf('jobs-start'))
		assert.ok(source.includes('(fn () ! {'))
		assert.ok(source.includes('fn swelte_app_shutdown() !'))
		assert.ok(source.includes("println('pool-close')"))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('shutdown hooks reject duplicate and invalid signatures', () => {
	const root = mkdtempSync(join(tmpdir(), 'swelte-stop-hook-'))
	try {
		mkdirSync(join(root, 'src'))
		const file = join(root, 'src/app.v')
		writeFileSync(file, 'module app\n@[shutdown]\npub fn finish() ! { return }')
		assert.match(loadServerHooks(root).shutdownBody!, /return/)
		writeFileSync(file, 'module app\n@[shutdown]\npub fn a() {}\n@[shutdown]\npub fn b() {}')
		assert.throws(() => loadServerHooks(root), /two @\[shutdown\]/)
		writeFileSync(file, 'module app\n@[shutdown]\npub fn a(value int) {}')
		assert.throws(() => loadServerHooks(root), /no params/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test('report hooks keep parameter names and reject invalid signatures', () => {
	const root = mkdtempSync(join(tmpdir(), 'swelte-report-hook-'))
	try {
		mkdirSync(join(root, 'src'))
		const file = join(root, 'src/app.v')
		writeFileSync(
			file,
			'module app\n@[report]\npub fn observe(entry SwelteReport) ! { println(entry.phase) }'
		)
		const hooks = loadServerHooks(root)
		assert.equal(hooks.reportParam, 'entry')
		assert.match(hooks.reportBody!, /entry.phase/)
		writeFileSync(file, 'module app\n@[report]\npub fn observe(entry string) {}')
		assert.throws(() => loadServerHooks(root), /SwelteReport/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
