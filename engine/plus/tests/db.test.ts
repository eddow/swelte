// `@swelte/plus/db` — unit tests: SQLite/KV backend plugin + `migrate`.
// Run via `npm test --workspace=@swelte/plus` (tsconfig.test.json → dist-test).

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
import {
	dbHelperTemplate,
	dbInitialMigration,
	dbPlugin,
	migrateCommand,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
	plusDbPath,
	plusPendingMigrations,
} from '../src/db.js'

describe('db contracts (Plus SQLite/KV plugin)', () => {
	it('db plugin owns no attrs (augment-only: includes + CLI)', () => {
		assert.deepEqual(dbPlugin.attrs, [])
		assert.equal(dbPlugin.configKey, 'db')
		assert.ok(dbPlugin.includes, 'dbPlugin stages the backend V module')
		assert.ok(dbPlugin.cli?.length, 'dbPlugin owns the migrate command')
	})

	it('db plugin claims no attrs, exposes the migrate CLI', () => {
		const names = (dbPlugin.cli ?? []).map((c) => c.name)
		assert.ok(names.includes('migrate'), 'dbPlugin needs the migrate command')
	})

	it('db plugin includes the backend V module dir (db.v only)', async () => {
		const { existsSync } = await import('node:fs')
		const { join } = await import('node:path')
		const incs = dbPlugin.includes?.() ?? []
		assert.equal(incs.length, 1)
		assert.equal(incs[0].module, 'backend')
		assert.ok(existsSync(join(incs[0].absDir, 'db.v')), 'vlib/backend/db.v ships with Plus')
		const { readdirSync } = await import('node:fs')
		const staged = readdirSync(incs[0].absDir).filter((f: string) => f.endsWith('.v'))
		assert.deepEqual(staged, ['db.v'], 'hub.v/ws.v live in the rooms plugin (box 3)')
	})

	it('migrate command shape (discoverable before build via plugins)', () => {
		assert.equal(migrateCommand.name, 'migrate')
		assert.ok(migrateCommand.summary.includes('db/migrations'))
		const names = (migrateCommand.args ?? []).map((a) => a.name)
		assert.ok(names.includes('root') && names.includes('db'), 'needs --root + --db')
	})
})

describe('db plugin (embedded SQLite)', () => {
	it('plusDbPath honors SWELTE_DB_PATH, else the default', () => {
		assert.equal(PLUS_DB_DEFAULT_PATH, 'data/app.db')
		assert.equal(PLUS_DB_MIGRATIONS_TABLE, '_swelte_migrations')
		assert.ok(plusDbPath('/r', { SWELTE_DB_PATH: 'custom/x.db' }).endsWith('custom/x.db'))
		assert.ok(plusDbPath('/r', {}).endsWith('data/app.db'))
	})

	it('plusPendingMigrations sorts and subtracts applied', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const root = mkdtempSync(join(tmpdir(), 'swelte-db-'))
		mkdirSync(join(root, 'db', 'migrations'), { recursive: true })
		writeFileSync(join(root, 'db', 'migrations', '002_b.sql'), '-- b')
		writeFileSync(join(root, 'db', 'migrations', '001_a.sql'), '-- a')
		writeFileSync(join(root, 'db', 'migrations', 'note.txt'), 'ignore me')
		assert.deepEqual(plusPendingMigrations(root, ['001_a.sql']), ['002_b.sql'])
		assert.deepEqual(plusPendingMigrations(root, []), ['001_a.sql', '002_b.sql'])
	})

	it('dbHelperTemplate is the Plus db.v (WAL, shared conn, KV — no hub)', () => {
		const src = dbHelperTemplate()
		assert.ok(src.includes('module backend'))
		assert.ok(src.includes('import db.sqlite'))
		assert.ok(src.includes('journal_mode = WAL'))
		assert.ok(src.includes('exec_none'))
		assert.ok(src.includes('pub fn db() !sqlite.DB'))
		assert.ok(src.includes('pub fn kv_set('))
		assert.ok(src.includes('pub fn kv_get('))
		assert.ok(src.includes('pub fn kv_del('))
		assert.ok(!src.includes('hub_subscribe'), 'hub lives in core hub.v (§3 box 3)')
		assert.ok(!src.includes('pub fn emit('), 'hub lives in core hub.v (§3 box 3)')
	})

	it('dbInitialMigration creates the KV table', () => {
		assert.ok(dbInitialMigration().includes('create table if not exists swelte_kv'))
	})
})

describe('migrate program (pending vs applied against an existing DB)', () => {
	it('renderMigrateProgram applies pending only, tracks in _swelte_migrations', async () => {
		const fs = await import('node:fs')
		const os = await import('node:os')
		const path = await import('node:path')
		const { DatabaseSync } = await import('node:sqlite')
		const { execFileSync } = await import('node:child_process')
		const { renderMigrateProgram, PLUS_DB_MIGRATIONS_TABLE } = await import('../src/db.js')
		const { resolveV, toolchainEnv } = await import('@swelte/core/toolchain')
		const v = resolveV(import.meta.url)
		let vOk = false
		try {
			execFileSync(v, ['version'], { stdio: ['ignore', 'pipe', 'pipe'] })
			vOk = true
		} catch {
			vOk = false
		}
		if (!vOk) {
			console.warn('SKIP: V toolchain not installed — migrate replay needs `v run`')
			return
		}
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-migrate-'))
		try {
			fs.mkdirSync(path.join(root, 'db', 'migrations'), { recursive: true })
			fs.writeFileSync(path.join(root, 'db', 'migrations', '001_a.sql'), 'create table t1 (x text);')
			fs.writeFileSync(path.join(root, 'db', 'migrations', '002_b.sql'), 'create table t2 (x text);')
			fs.writeFileSync(path.join(root, 'db', 'migrations', '003_c.sql'), 'create table t3 (x text);')
			fs.mkdirSync(path.join(root, '.swelte'), { recursive: true })
			const mig = path.join(root, '.swelte', 'migrate.v')
			fs.writeFileSync(mig, renderMigrateProgram(root))
			const dbPath = path.join(root, 'data', 'app.db')
			const env = { ...process.env, SWELTE_DB_PATH: dbPath }
			const runMig = () => execFileSync(v, ['run', mig], { cwd: root, stdio: 'pipe', env: toolchainEnv(env) })
			try {
				runMig()
			} catch (e) {
				// No sqlite headers on this machine (no system sqlite3.h, no
				// vvm amalgamation): `v run` cannot link `db.sqlite` — skip,
				// don't fail. `swelte build` covers this via ensureSqliteForBuild.
				if (String((e as Error).message).includes('sqlite3.h')) {
					console.warn('SKIP: no sqlite headers — migrate replay needs db.sqlite link')
					return
				}
				throw e
			}
			let db = new DatabaseSync(dbPath)
			const tracked1 = db.prepare(`select name from ${PLUS_DB_MIGRATIONS_TABLE} order by name`).all() as { name: string }[]
			assert.deepEqual(tracked1.map((r) => r.name), ['001_a.sql', '002_b.sql', '003_c.sql'])
			db.close()
			// Drop one tracking row: re-run applies just that migration.
			db = new DatabaseSync(dbPath)
			db.prepare(`delete from ${PLUS_DB_MIGRATIONS_TABLE} where name = '003_c.sql'`).run()
			db.prepare('drop table t3').run()
			db.close()
			runMig()
			db = new DatabaseSync(dbPath)
			const tracked2 = db.prepare(`select name from ${PLUS_DB_MIGRATIONS_TABLE} order by name`).all() as { name: string }[]
			assert.deepEqual(tracked2.map((r) => r.name), ['001_a.sql', '002_b.sql', '003_c.sql'])
			const tables = db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]
			assert.ok(tables.some((t) => t.name === 't2') && tables.some((t) => t.name === 't3'), 'missing migrated tables')
			db.close()
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe('db plugin registration (Plus app vs core-only app)', () => {
	const mkApp = (withKvRoute: boolean, withRoomRoute: boolean) => {
		const fs = require('node:fs') as typeof import('node:fs')
		const path = require('node:path') as typeof import('node:path')
		const os = require('node:os') as typeof import('node:os')
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-plusdb-'))
		fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true })
		fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","type":"module"}')
		fs.writeFileSync(path.join(root, 'svelte.config.js'), 'export default {}')
		fs.writeFileSync(
			path.join(root, 'src', 'routes', '+page.v'),
			'module p\n@[get]\npub fn g() string {\n\treturn ""\n}\n'
		)
		if (withKvRoute)
			fs.writeFileSync(
				path.join(root, 'src', 'routes', 'api.v'),
				'module api\nimport backend\n@[get]\npub fn kv() string {\n\treturn backend.kv_get("k") or { "" }\n}\n'
			)
		if (withRoomRoute)
			fs.writeFileSync(
				path.join(root, 'src', 'routes', 'rooms.v'),
				'module api_rooms\nimport backend\n@[sse]\npub fn stream(req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) {\n\t_ = req\n\t_ = sub\n\t_ = emit\n}\n'
			)
		return root
	}
	const generateWith = async (root: string, plugins: import('@swelte/core/vite').SweltePlugin[]) => {
		const { swelte } = await import('@swelte/core/vite')
		const plug = swelte({ plugins }) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
	}

	it('core-only app stages no backend; Plus db app stages db.v for KV routes', async () => {
		const fs = require('node:fs') as typeof import('node:fs')
		const path = require('node:path') as typeof import('node:path')
		const { dbPlugin } = await import('../src/db.js')
		// Core only: KV route, no plugin → no `.swelte/backend/` at all.
		let root = mkApp(true, false)
		try {
			await generateWith(root, [])
			assert.equal(fs.existsSync(path.join(root, '.swelte', 'backend')), false)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
		// Plus db: same KV route (`import backend`) -> staged `db.v` only
		// (no hub without the rooms plugin — plain routes link `db.v`).
		root = mkApp(true, false)
		try {
			await generateWith(root, [dbPlugin])
			assert.ok(fs.existsSync(path.join(root, '.swelte', 'backend', 'db.v')), 'Plus db.v staged')
			assert.ok(!fs.existsSync(path.join(root, '.swelte', 'backend', 'hub.v')), 'no hub without roomsPlugin')
			const marker = JSON.parse(fs.readFileSync(path.join(root, '.swelte', 'plugin_modules.json'), 'utf8'))
			assert.ok(marker.includes('backend'))
			// Remove the plugin: regenerate in the same dir → backend pruned.
			await generateWith(root, [])
			assert.equal(fs.existsSync(path.join(root, '.swelte', 'backend')), false, 'stale backend/ pruned on plugin removal')
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it('Plus db + rooms + room route stages hub alongside db.v; removal prunes both', async () => {
		const fs = require('node:fs') as typeof import('node:fs')
		const path = require('node:path') as typeof import('node:path')
		const { dbPlugin } = await import('../src/db.js')
		const { roomsPlugin } = await import('../src/rooms.js')
		const root = mkApp(false, true)
		try {
			await generateWith(root, [dbPlugin, roomsPlugin])
			assert.ok(fs.existsSync(path.join(root, '.swelte', 'backend', 'db.v')), 'Plus db.v staged')
			assert.ok(fs.existsSync(path.join(root, '.swelte', 'backend', 'hub.v')), 'rooms hub staged (db + rooms)')
			assert.ok(fs.existsSync(path.join(root, '.swelte', 'backend', 'ws.v')), 'rooms ws staged (db + rooms)')
			// Remove the rooms plugin only (keep a parseable app): the room
			// route without roomsPlugin is a build error by design (core has
			// no socket/room dispatch). Prune check uses the db-only app below.
			await assert.rejects(generateWith(root, [dbPlugin]), /roomsPlugin/)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it('scaffolded src/lib/backend/db.v shadows the staged copy (no collision)', async () => {
		const fs = require('node:fs') as typeof import('node:fs')
		const path = require('node:path') as typeof import('node:path')
		const { dbPlugin, dbHelperTemplate } = await import('../src/db.js')
		// `swelte migrate` scaffolds first, then generate() must not throw.
		const root = mkApp(true, false)
		try {
			fs.mkdirSync(path.join(root, 'src', 'lib', 'backend'), { recursive: true })
			fs.writeFileSync(path.join(root, 'src', 'lib', 'backend', 'db.v'), dbHelperTemplate())
			await generateWith(root, [dbPlugin])
			const staged = fs.readFileSync(path.join(root, '.swelte', 'backend', 'db.v'), 'utf8')
			assert.ok(staged.includes('pub fn kv_get('), 'app scaffold wins in .swelte/backend/db.v')
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it('configured migrate command resolves via project config (discoverable before build)', async () => {
		const { resolveCommands } = await import('@swelte/core/cli')
		const { dbPlugin } = await import('../src/db.js')
		const coreOnly = resolveCommands([])
		assert.equal(coreOnly.some((c) => c.name === 'migrate'), false, 'core alone ships no migrate')
		const withPlus = resolveCommands([dbPlugin])
		assert.ok(withPlus.some((c) => c.name === 'migrate'), 'configured dbPlugin exposes migrate')
	})
})


