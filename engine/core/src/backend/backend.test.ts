// `@swelte/core/backend` — unit tests: hub-transport gate (§3 box 3).
// SQLite/KV + `migrate` live in `@swelte/plus/db` (§3 box 2, see
// `engine/plus/tests/db.test.ts`); cron/jobs live in `@swelte/plus/jobs`
// (§3 box 1, see `engine/plus/tests/jobs.test.ts`).
// Run via `npm test --workspace=@swelte/core` (tsconfig.test.json → dist-test).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { coreBackendVlibDir, coreHubVlibFiles, hasPlusDbPlugin } from './hub-index.js'

describe('hub gate (core transport, no DB, no CLI, no attrs)', () => {
	it('core ships only hub transport files (hub.v + ws.v, never db.v)', () => {
		assert.deepEqual(coreHubVlibFiles(), ['hub.v', 'ws.v'])
	})

	it('hasPlusDbPlugin is a name check (core never imports plugin code)', () => {
		assert.equal(hasPlusDbPlugin([]), false)
		assert.equal(hasPlusDbPlugin([{ name: 'jobs', attrs: [] }]), false)
		assert.equal(hasPlusDbPlugin([{ name: 'db', attrs: [] }]), true)
	})

	it('hub template is sqlite-free (SQLite lives in Plus db.v)', async () => {
		const { readFileSync } = await import('node:fs')
		const { join } = await import('node:path')
		const src = readFileSync(join(coreBackendVlibDir(), 'hub.v'), 'utf8')
		assert.ok(src.includes('module backend'))
		assert.ok(!src.includes('db.sqlite'), 'hub.v must not import db.sqlite')
		assert.ok(src.includes('pub fn emit(room string, msg string) int'))
		assert.ok(src.includes('pub fn hub_subscribe(room string) (chan string, int)'))
		assert.ok(src.includes('pub fn hub_unsubscribe(room string, id int)'))
		assert.ok(src.includes('pub fn hub_lock()'))
		assert.ok(src.includes('pub fn hub_add('))
		assert.ok(src.includes('pub fn hub_remove('))
		assert.ok(src.includes('pub fn hub_listeners('))
	})

	it('ws frame helpers ship in the core backend module (RFC 6455)', async () => {
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
		assert.ok(src.includes('net.TcpConn') || src.includes('net.'), 'conn-level framing present')
	})
})
