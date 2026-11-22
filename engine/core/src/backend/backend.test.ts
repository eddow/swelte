// `@swelte/core/backend` — unit tests: embedded backend (db). Cron/jobs live
// in `@swelte/plus` (see `engine/plus/tests/jobs.test.ts`).
// Run via `npm test --workspace=@swelte/core` (tsconfig.test.json → dist-test).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	coreBackendVlibDir,
	dbHelperTemplate,
	dbInitialMigration,
	dbPlugin,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
	plusDbPath,
	plusPendingMigrations,
} from './jobs-index.js'


describe('db contracts (embedded backend)', () => {
	it('db plugin owns no attrs (augment-only: includes + CLI)', () => {
		assert.deepEqual(dbPlugin.attrs, [])
		assert.equal(dbPlugin.configKey, 'db')
		assert.ok(dbPlugin.includes, 'dbPlugin stages the backend V module')
		assert.ok(dbPlugin.cli?.length, 'dbPlugin owns the migrate command')
	})
})

describe('db plugin (embedded SQLite)', () => {
	it('db plugin claims no attrs, exposes the migrate CLI', () => {
		assert.deepEqual(dbPlugin.attrs, [])
		assert.equal(dbPlugin.configKey, 'db')
		const names = (dbPlugin.cli ?? []).map((c) => c.name)
		assert.ok(names.includes('migrate'), 'dbPlugin needs the migrate command')
	})
	it('db plugin includes the backend V module dir', async () => {
		const { existsSync } = await import('node:fs')
		const { join } = await import('node:path')
		const incs = dbPlugin.includes?.() ?? []
		assert.equal(incs.length, 1)
		assert.equal(incs[0].module, 'backend')
		assert.ok(existsSync(join(incs[0].absDir, 'db.v')), 'vlib/backend/db.v ships')
		assert.equal(coreBackendVlibDir(), incs[0].absDir)
	})
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
	it('dbHelperTemplate is backend-shaped (WAL, shared conn, KV)', () => {
		const src = dbHelperTemplate()
		assert.ok(src.includes('module backend'))
		assert.ok(src.includes('import db.sqlite'))
		assert.ok(src.includes('journal_mode = WAL'))
		assert.ok(src.includes('exec_none'))
		assert.ok(src.includes('pub fn db() !sqlite.DB'))
		assert.ok(src.includes('pub fn kv_set('))
		assert.ok(src.includes('pub fn kv_get('))
		assert.ok(src.includes('pub fn kv_del('))
	})
	it('dbInitialMigration creates the KV table', () => {
		assert.ok(dbInitialMigration().includes('create table if not exists swelte_kv'))
	})
	it('dbHelperTemplate carries the broadcast hub (emit/subscribe/unsubscribe)', () => {
		const src = dbHelperTemplate()
		assert.ok(src.includes('pub fn emit(room string, msg string) int'))
		assert.ok(src.includes('pub fn hub_subscribe(room string) (chan string, int)'))
		assert.ok(src.includes('pub fn hub_unsubscribe(room string, id int)'))
		assert.ok(src.includes('pub fn hub_lock()'))
		assert.ok(src.includes('pub fn hub_add('))
		assert.ok(src.includes('pub fn hub_remove('))
		assert.ok(src.includes('pub fn hub_listeners('))
	})
	it('ws frame helpers ship in the backend module (RFC 6455)', async () => {
		const { readFileSync, existsSync } = await import('node:fs')
		const { join } = await import('node:path')
		const ws = join(coreBackendVlibDir(), 'ws.v')
		assert.ok(existsSync(ws), 'vlib/backend/ws.v ships with core')
		const src = readFileSync(ws, 'utf8')
		assert.ok(src.includes('module backend'))
		assert.ok(src.includes('pub fn ws_accept_key('), 'RFC 6455 accept key')
		assert.ok(src.includes('258EAFA5-E914-47DA-95CA-C5AB0DC85B11'), 'websocket GUID')
		assert.ok(src.includes('pub fn ws_write_text('), 'unmasked server→client frames')
		assert.ok(src.includes('pub fn ws_read_frame_timeout('), 'timeout-idle framing')
		// Harness owns the hub channels (db.v); ws.v owns the wire framing.
		assert.ok(src.includes('net.TcpConn') || src.includes('net.'), 'conn-level framing present')
	})
})
