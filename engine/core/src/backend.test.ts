import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
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
