// `@swelte/plus/rooms` — room hub + WebSocket integration (explicit plugin).
// Owns `@[ws]` + room-mode `@[sse]` (§3 box 3). Core keeps HTTP verbs,
// plain SSE (list/emit), and the WS *transport* (upgrade handshake + socket
// pump in the server harness, `__swelteWsUrl` client URL builder). The hub,
// room dispatch and socket-open wiring arrive only with this plugin:
// `swelte({ plugins: [roomsPlugin] })`.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineSweltePlugin } from '@swelte/core/vite'
import type { RpcFn, SweltePlugin } from '@swelte/core/vite'

const EMIT_RE = /^fn\s*\(\s*string\s*\)(\s*bool)?$/
const SUB_RE = /^fn\s*\(\s*string\s*\)\s*chan\s+string$/

function tailKind(params: { vtype: string }[]): 'emit' | 'room' | 'socket' | null {
	if (!params.length) return null
	const last = params[params.length - 1]?.vtype.trim() ?? ''
	if (!EMIT_RE.test(last)) return null
	if (params.length >= 3) {
		const recv = params[params.length - 2]?.vtype.trim() ?? ''
		const sub = params[params.length - 3]?.vtype.trim() ?? ''
		if (/^chan\s+string$/.test(recv) && SUB_RE.test(sub)) return 'socket'
	}
	if (params.length >= 2 && SUB_RE.test(params[params.length - 2]?.vtype.trim() ?? '')) return 'room'
	return 'emit'
}

/** Absolute dir of the shipped rooms backend modules (`hub.v` + `ws.v`). */
export function plusRoomsVlibDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url))
	for (let i = 0; i < 4; i++) {
		const cand = join(dir, 'vlib', 'rooms')
		if (existsSync(join(cand, 'hub.v'))) return cand
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return join(dirname(fileURLToPath(import.meta.url)), '..', 'vlib', 'rooms')
}

/** Shape errors for room-mode `@[sse]` fns (file+line via `rel`). */
export function validateRoomSseFn(rel: string, fn: { name: string; params?: { name: string; vtype: string }[]; vret?: string; qualifier?: string }): void {
	const kind = tailKind((fn.params ?? []) as { vtype: string }[])
	if (kind !== 'room') {
		throw new Error(
			`[swelte] ${rel}: @[sse] ${fn.name} room mode needs (…, sub fn (string) chan string, emit fn (string) bool) — plain list/emit SSE stays core-owned, rooms need plugins: [roomsPlugin].`,
		)
	}
	if (fn.vret !== 'void') {
		throw new Error(`[swelte] ${rel}: @[sse] ${fn.name} room mode must return void (got ${fn.vret || '(none)'}).`)
	}
	const userParams = (fn.params ?? []).slice(0, -2)
	for (const p of userParams as { name: string; vtype: string }[]) {
		if (/^fn\s*\(/.test(p.vtype.trim())) {
			throw new Error(`[swelte] ${rel}: @[sse] ${fn.name} param ${p.name} is a closure (${p.vtype}) — only the trailing sub/emit closures are harness-injected.`)
		}
	}
}

/** Shape errors for `@[ws]` socket fns (file+line via `rel`). */
export function validateRoomWsFn(
	rel: string,
	fn: { name: string; params?: { name: string; vtype: string }[]; vret?: string; qualifier?: string },
): void {
	const kind = tailKind((fn.params ?? []) as { vtype: string }[])
	if (kind !== 'socket') {
		throw new Error(
			`[swelte] ${rel}: @[ws] ${fn.name} needs trailing (sub fn (string) chan string, recv chan string, emit fn (string) bool) — sockets need plugins: [roomsPlugin].`,
		)
	}
	if (fn.vret !== 'void') {
		throw new Error(`[swelte] ${rel}: @[ws] ${fn.name} must return void (got ${fn.vret || '(none)'}).`)
	}
	if (fn.qualifier) {
		throw new Error(`[swelte] ${rel}: @[ws] ${fn.name} takes no qualifier (one socket per file — the route joins rooms inside).`)
	}
	const userParams = (fn.params ?? []).slice(0, -3) as { vtype: string }[]
	if (userParams.length !== 1 || userParams[0].vtype !== 'SwelteRequest') {
		throw new Error(`[swelte] ${rel}: @[ws] ${fn.name} must take (SwelteRequest, sub, recv, emit).`)
	}
}

/** Narrow a room/socket call: room routes declare `(SwelteRequest, sub, ...)`
 *  and the harness injects sub/recv/emit. Narrow query params are not
 *  supported on room routes (keep the room contract tight). */
function roomCallArgs(fn: { name: string; params?: { name: string; vtype: string }[] }, tail: 'room' | 'socket'): string {
	const ps = (fn.params ?? []).slice(0, tail === 'socket' ? -3 : -2)
	if (ps.length === 1 && ps[0].vtype === 'SwelteRequest') return tail === 'socket' ? 'req, sub, recv, emit' : 'req, sub, emit'
	if (ps.length === 0) return tail === 'socket' ? 'sub, recv, emit' : 'sub, emit'
	throw new Error(`[swelte] @[sse]/@[ws] ${fn.name}: room/socket fns take (SwelteRequest, sub, ...) — narrow query params are not supported on room routes.`)
}

function roomCond(fn: { qualifier?: string }): string {
	return fn.qualifier ? `qualifier == '${fn.qualifier}'` : `qualifier == ''`
}

function roomPrefixOf(mod: string): string {
	return `swelte_${mod.replace(/[^A-Za-z0-9_]/g, '_')}_`
}

/** Route-leaf room/WS accessors for one file (appended via `emitRoute`). */
export function emitRoomsRoute(prefix: string, fns: { name: string; attr: string; qualifier?: string; params?: { name: string; vtype: string }[]; vret?: string; fallible?: boolean }[]): string {
	const roomFns = fns.filter((f) => f.attr === 'sse' && tailKind((f.params ?? []) as { vtype: string }[]) === 'room')
	const wsFns = fns.filter((f) => f.attr === 'ws')
	if (!roomFns.length && !wsFns.length) return ''
	const roomArm = (h: (typeof roomFns)[number]): string => {
		const call = roomCallArgs(h, 'room')
		const run = h.fallible ? `${prefix}${h.name}(${call}) or { return err }` : `${prefix}${h.name}(${call})`
		return `\tif ${roomCond(h)} {\n\t\t${run}\n\t\treturn\n\t}`
	}
	const openArm = (h: (typeof wsFns)[number]): string => {
		const call = roomCallArgs(h, 'socket')
		const run = h.fallible ? `${prefix}${h.name}(${call}) or { return err }` : `${prefix}${h.name}(${call})`
		return `\tif qualifier == '' {\n\t\t${run}\n\t\treturn\n\t}`
	}
	const quals = [...roomFns, ...wsFns].filter((h) => h.qualifier).map((h) => `'${h.qualifier}'`)
	const qualErr = `\treturn error('unknown qualifier: ' + qualifier + ' (available: [${quals.join(', ')}])')`
	const noQualErr = `\treturn error('unknown qualifier for ws: ' + qualifier)`
	const parts: string[] = []
	if (roomFns.length)
		parts.push(`pub fn ${prefix}sse_room(qualifier string, req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) ! {\n${roomFns.map(roomArm).join('\n')}\n${qualErr}\n}`)
	parts.push(`pub fn ${prefix}sse_is_room() bool {\n\treturn ${roomFns.length > 0}\n}`)
	if (wsFns.length)
		parts.push(`pub fn ${prefix}swelte_ws_is() bool {\n\treturn true\n}\n\npub fn ${prefix}swelte_ws_open(qualifier string, req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) ! {\n${wsFns.map(openArm).join('\n')}\n${noQualErr}\n}`)
	else parts.push(`pub fn ${prefix}swelte_ws_is() bool {\n\treturn false\n}`)
	return parts.join('\n\n')
}

/** Dispatch-table room/WS fan-out (appended via `emitServerGen`). Room
 *  tables only fan out routes with a room-mode `sse` fn; socket tables
 *  only routes with a `ws` fn. A room-only file has no `swelte_ws_open`
 *  accessor (and vice versa) — cross-calling them would not compile.
 *  The `swelte_ws_route` upgrade predicate is room dispatch too: without
 *  any socket route it answers '' (same shape as core's empty table, so
 *  the harness upgrade path compiles with or without socket routes). */
export function emitRoomsServerGen(
	routes: { route: string; prefix: string; attrs: string[]; room: boolean; socket: boolean }[],
): string {
	if (!routes.length) return ''
	const roomRoutes = routes.filter((r) => r.room)
	const wsRoutes = routes.filter((r) => r.socket)
	if (!roomRoutes.length && !wsRoutes.length) return ''
	const arm = (rows: string[], tail: string): string => (rows.length ? `${rows.join('\n')}\n${tail}` : tail)
	const roomArms = roomRoutes.map(
		(r) => `\tif prefix == '${r.prefix}' { ${r.prefix}sse_room(qualifier, req, sub, emit) or { return err } return }`,
	)
	const wsArms = wsRoutes.map(
		(r) => `\tif prefix == '${r.prefix}' { ${r.prefix}swelte_ws_open('', req, sub, recv, emit) or { return err } return }`,
	)
	const isArms = roomRoutes.map((r) => `\tif prefix == '${r.prefix}' { return ${r.prefix}sse_is_room() }`)
	const wsIsArms = wsRoutes.map((r) => `\tif prefix == '${r.prefix}' { return ${r.prefix}swelte_ws_is() }`)
	const wsHitArms = wsRoutes.map(
		(r) => `\tif swelte_route_hit('${r.route}', norm_path) { return '${r.prefix}' }`,
	)
	return `pub fn swelte_sse_is_room(prefix string) bool {\n${arm(isArms, '\treturn false')}\n}\n\npub fn swelte_sse_room_for(prefix string, qualifier string, req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) ! {\n${arm(roomArms, `\treturn error('no sse room route for prefix: ' + prefix)`)}\n}\n\npub fn swelte_ws_route(path string, method string, headers map[string]string) string {\n\tif method != 'GET' { return '' }\n\tif (headers['Upgrade'] or { headers['upgrade'] or { '' } }).to_lower() != 'websocket' { return '' }\n${wsHitArms.length ? '\tnorm_path := swelte_normalize_path(path)\n' + wsHitArms.join('\n') + "\n\treturn ''" : "\t_ = path\n\treturn ''"}\n}\n\npub fn swelte_ws_is(prefix string) bool {\n${arm(wsIsArms, '\treturn false')}\n}\n\npub fn swelte_ws_open_for(prefix string, req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) ! {\n${arm(wsArms, `\treturn error('no ws route for prefix: ' + prefix)`)}\n}`
}

/** Plus `rooms` plugin: claims `@[ws]` + room-mode `@[sse]`, stages the hub. */
export const roomsPlugin: SweltePlugin = defineSweltePlugin({
	name: 'rooms',
	attrs: ['ws', 'sse'],
	configKey: 'rooms',
	includes: () => [{ module: 'backend', absDir: plusRoomsVlibDir() }],
	validate: (rel, fn) => {
		const full = fn as unknown as { name: string; attr: string; qualifier?: string; params?: { name: string; vtype: string }[]; vret?: string }
		const kind = tailKind((full.params ?? []) as { vtype: string }[])
		if (full.attr === 'ws') {
			validateRoomWsFn(rel, full)
			return
		}
		// `sse` is a shared attr: core owns list/emit shapes, Plus owns room.
		if (full.attr === 'sse' && kind === 'room') validateRoomSseFn(rel, full)
	},
	emitRoute: (ctx, fns) =>
		emitRoomsRoute(roomPrefixOf(ctx.mod), fns as never),
	emitServerGen: (routes) => emitRoomsServerGen(routes as never),
})
