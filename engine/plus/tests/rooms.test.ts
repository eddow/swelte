// `@swelte/plus/rooms` — unit tests: room hub + WebSocket plugin (box 3).
// Run via `npm test --workspace=@swelte/plus` (tsconfig.test.json → dist-test).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	plusRoomsVlibDir,
	roomsPlugin,
	validateRoomSseFn,
	validateRoomWsFn,
} from '../src/rooms.js'

describe('rooms contracts (explicit room-hub plugin)', () => {
	it('rooms plugin claims ws + sse (Plus-owned), stages the hub', () => {
		assert.deepEqual([...roomsPlugin.attrs].sort(), ['sse', 'ws'])
		assert.equal(roomsPlugin.configKey, 'rooms')
		assert.ok(roomsPlugin.validate, 'roomsPlugin needs validate')
		const incs = roomsPlugin.includes?.() ?? []
		assert.equal(incs.length, 1)
		assert.equal(incs[0].module, 'backend')
	})

	it('rooms vlib ships hub.v + ws.v (never db.v)', async () => {
		const { existsSync, readdirSync } = await import('node:fs')
		const { join } = await import('node:path')
		const dir = plusRoomsVlibDir()
		assert.ok(existsSync(join(dir, 'hub.v')), `hub.v ships with Plus rooms (dir ${dir})`)
		assert.ok(existsSync(join(dir, 'ws.v')), `ws.v ships with Plus rooms (dir ${dir})`)
		const staged = readdirSync(dir).filter((f: string) => f.endsWith('.v')).sort()
		assert.ok(staged.includes('hub.v') && staged.includes('ws.v'), `hub+ws staged (got ${staged})`)
		assert.ok(!staged.includes('db.v'), 'db.v stays in the db plugin dir')
	})

	it('rooms vlib is sqlite-free in the hub (SQLite lives in Plus db.v)', async () => {
		const { readFileSync } = await import('node:fs')
		const { join } = await import('node:path')
		const hub = readFileSync(join(plusRoomsVlibDir(), 'hub.v'), 'utf8')
		assert.ok(hub.includes('module backend'))
		assert.ok(!hub.includes('db.sqlite'), 'hub.v must not import db.sqlite')
		assert.ok(hub.includes('pub fn emit(room string, msg string) int'))
		assert.ok(hub.includes('pub fn hub_subscribe(room string) (chan string, int)'))
		assert.ok(hub.includes('pub fn hub_unsubscribe(room string, id int)'))
	})

	it('ws frame helpers ship in the rooms backend module (RFC 6455)', async () => {
		const { readFileSync } = await import('node:fs')
		const { join } = await import('node:path')
		const ws = readFileSync(join(plusRoomsVlibDir(), 'ws.v'), 'utf8')
		assert.ok(ws.includes('module backend'))
		assert.ok(ws.includes('pub fn ws_accept_key('))
		assert.ok(ws.includes('258EAFA5-E914-47DA-95CA-C5AB0DC85B11'), 'websocket GUID')
		assert.ok(ws.includes('pub fn ws_write_text('))
	})

	it('validateRoomWsFn accepts the socket tail, rejects the rest', () => {
		const good = {
			name: 'sock',
			params: [
				{ name: 'req', vtype: 'SwelteRequest' },
				{ name: 'sub', vtype: 'fn (string) chan string' },
				{ name: 'recv', vtype: 'chan string' },
				{ name: 'emit', vtype: 'fn (string) bool' },
			],
			vret: 'void',
		}
		validateRoomWsFn('r/api/sock.v', good)
		assert.throws(() => validateRoomWsFn('r/api/sock.v', { ...good, vret: 'string' }), /must return void/)
		assert.throws(
			() => validateRoomWsFn('r/api/sock.v', { ...good, qualifier: 'q' }),
			/takes no qualifier/,
		)
		assert.throws(
			() => validateRoomWsFn('r/api/sock.v', { name: 's', params: [{ name: 'req', vtype: 'SwelteRequest' }], vret: 'void' }),
			/needs trailing/,
		)
	})

	it('validateRoomSseFn accepts the room tail only', () => {
		const good = {
			name: 'stream',
		params: [
			{ name: 'req', vtype: 'SwelteRequest' },
			{ name: 'sub', vtype: 'fn (string) chan string' },
			{ name: 'emit', vtype: 'fn (string) bool' },
			],
			vret: 'void',
		}
		validateRoomSseFn('r/api/rooms.v', good)
		assert.throws(
			() => validateRoomSseFn('r/api/rooms.v', { ...good, vret: 'string' }),
			/must return void/,
		)
	})

	it('rooms validate() routes ws always, sse only for room tails', () => {
		const ws = { name: 'sock', attr: 'ws', params: [{ name: 'req', vtype: 'SwelteRequest' }], vret: 'void' }
		assert.throws(() => roomsPlugin.validate?.('r/api/sock.v', ws as never), /needs trailing/)
		// Plain emit SSE is core-owned: plugin validate ignores it.
		roomsPlugin.validate?.('r/api/greet.v', {
			name: 'tick',
			attr: 'sse',
			params: [{ name: 'emit', vtype: 'fn (string) bool' }],
			vret: 'void',
		} as never)
		// Room SSE validates (room tail + bad return -> throws; plain tail -> ignored).
		assert.throws(
			() =>
				roomsPlugin.validate?.('r/api/rooms.v', {
					name: 'stream',
					attr: 'sse',
					params: [
						{ name: 'req', vtype: 'SwelteRequest' },
						{ name: 'sub', vtype: 'fn (string) chan string' },
						{ name: 'emit', vtype: 'fn (string) bool' },
					],
					vret: 'string',
				} as never),
			/must return void/,
		)
	})
})
