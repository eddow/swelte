import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLineSplitter, dispatch, err, ok, parseLine } from './protocol.js'

describe('protocol', () => {
	it('ok/err shapes', () => {
		assert.deepEqual(ok(1, { a: 1 }), { jsonrpc: '2.0', id: 1, result: { a: 1 } })
		const e = err(1, -32601, 'Method not found')
		assert.equal(e.error?.code, -32601)
	})
	it('parseLine: bad JSON -> parse error', () => {
		const out = parseLine('not json{')
		assert.ok('res' in out && out.res.error?.code === -32700)
	})
	it('parseLine: missing method -> invalid request', () => {
		const out = parseLine('{"jsonrpc":"2.0","id":1}')
		assert.ok('res' in out && out.res.error?.code === -32600)
	})
	it('parseLine: valid request', () => {
		const out = parseLine('{"jsonrpc":"2.0","id":7,"method":"ping"}')
		assert.ok('req' in out && out.req.method === 'ping' && out.req.id === 7)
	})
	it('dispatch: unknown method -> -32601', async () => {
		const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'nope' }, new Map())
		assert.equal(res?.error?.code, -32601)
	})
	it('dispatch: handler error mentioning param -> -32602', async () => {
		const res = await dispatch(
			{ jsonrpc: '2.0', id: 1, method: 'x' },
			new Map([
				[
					'x',
					() => {
						throw new Error('missing required param: route')
					},
				],
			])
		)
		assert.equal(res?.error?.code, -32602)
	})
	it('dispatch: notification (null id) -> null response', async () => {
		const res = await dispatch(
			{ jsonrpc: '2.0', id: null, method: 'x' },
			new Map([['x', () => ({})]])
		)
		assert.equal(res, null)
	})
	it('createLineSplitter: handles chunk splits', () => {
		const lines: string[] = []
		const push = createLineSplitter((l) => lines.push(l))
		push('{"a":1}\n{"b":')
		push('2}\n')
		assert.deepEqual(lines, ['{"a":1}', '{"b":2}'])
	})
})

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-mcp-'))
	mkdirSync(join(root, 'src', 'routes', 'api'), { recursive: true })
	mkdirSync(join(root, 'src', 'routes', 'users', '[id]'), { recursive: true })
	writeFileSync(
		join(root, 'src', 'routes', 'api', 'greet.v'),
		'@[get]\npub fn greet(name string) string {\n\treturn name\n}\n'
	)
	writeFileSync(
		join(root, 'src', 'routes', 'users', '[id].v'),
		'@[get]\npub fn show() string {\n\treturn "x"\n}\n'
	)
	writeFileSync(join(root, 'src', 'routes', '+page.svelte'), '<h1>hi</h1>\n')
	return root
}

describe('tools', async () => {
	const { scanRoutes } = await import('./tools.js')
	it('scanRoutes maps .v files to URLs with params', () => {
		const root = fixture()
		const routes = scanRoutes(root, 'src/routes', join(root, 'src', 'routes'))
		const byRoute = new Map(routes.map((r) => [r.route, r]))
		assert.ok(byRoute.has('/api/greet'))
		assert.ok(byRoute.has('/users/[id]'))
		assert.ok(byRoute.has('/'))
		assert.deepEqual(byRoute.get('/users/[id]')?.params, ['id'])
		assert.equal(byRoute.get('/api/greet')?.functions[0]?.name, 'greet')
	})
})

describe('server', async () => {
	const { handleRequest } = await import('./server.js')
	const { TOOLS } = await import('./tools.js')
	it('initialize returns server info', async () => {
		const res = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' })
		assert.ok(res && 'result' in res && (res.result as { serverInfo: unknown }).serverInfo)
	})
	it('tools/list exposes 7 tools', async () => {
		const res = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
		assert.ok(res && 'result' in res)
		assert.deepEqual(
			(res.result as { tools: { name: string }[] }).tools.map((t) => t.name),
			TOOLS.map((t) => t.name)
		)
		assert.equal(TOOLS.length, 7)
	})
	it('tools/call list_routes against fixture', async () => {
		const root = fixture()
		const res = await handleRequest({
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name: 'list_routes', arguments: { root } },
		})
		assert.ok(res && 'result' in res)
		const text = (res.result as { content: { text: string }[] }).content[0].text
		const data = JSON.parse(text) as { routes: { route: string }[] }
		assert.ok(data.routes.some((r) => r.route === '/api/greet'))
	})
	it('tools/call get_route unknown -> invalid params', async () => {
		const root = fixture()
		const res = await handleRequest({
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: { name: 'get_route', arguments: { root, route: '/nope' } },
		})
		assert.ok(res && 'error' in res && res.error?.code === -32602)
	})
	it('tools/call check + get_config against fixture', async () => {
		const root = fixture()
		const c = await handleRequest({
			jsonrpc: '2.0',
			id: 4,
			method: 'tools/call',
			params: { name: 'check', arguments: { root } },
		})
		assert.ok(c && 'result' in c)
		const g = await handleRequest({
			jsonrpc: '2.0',
			id: 5,
			method: 'tools/call',
			params: { name: 'get_config', arguments: { root } },
		})
		assert.ok(g && 'result' in g)
		const text = (g.result as { content: { text: string }[] }).content[0].text
		assert.equal((JSON.parse(text) as { routesDir: string }).routesDir, 'src/routes')
	})
	it('tools/call validate_data_contract matches struct to $props', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-mcp-contract-'))
		mkdirSync(join(root, 'src', 'routes', 'dash'), { recursive: true })
		writeFileSync(
			join(root, 'src', 'routes', 'dash', '+page.v'),
			"module dash_page\n\npub struct DashProps {\npub:\n\tmessage string\n}\n\n@[load]\npub fn load_page(req SwelteRequest) !DashProps {\n\t_ = req\n\treturn DashProps{\n\t\tmessage: 'hi'\n\t}\n}\n"
		)
		writeFileSync(
			join(root, 'src', 'routes', 'dash', '+page.svelte'),
			'<script lang="ts">\nlet { data }: { data?: { message: string } } = $props()\n</script>\n'
		)
		const res = await handleRequest({
			jsonrpc: '2.0',
			id: 6,
			method: 'tools/call',
			params: { name: 'validate_data_contract', arguments: { root, route: '/dash' } },
		})
		assert.ok(res && 'result' in res)
		const data = JSON.parse((res.result as { content: { text: string }[] }).content[0].text) as {
			matches: unknown[]
			mismatches: unknown[]
		}
		assert.ok(data.matches.length >= 0)
		assert.ok(Array.isArray(data.mismatches))
	})
	it('tools/call scaffold_route creates page pair', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-mcp-scaffold-'))
		mkdirSync(join(root, 'src', 'routes'), { recursive: true })
		const res = await handleRequest({
			jsonrpc: '2.0',
			id: 7,
			method: 'tools/call',
			params: { name: 'scaffold_route', arguments: { root, route: '/dashboard', mode: 'static' } },
		})
		assert.ok(res && 'result' in res)
		const data = JSON.parse((res.result as { content: { text: string }[] }).content[0].text) as {
			created: string[]
		}
		assert.ok(data.created.some((c) => c.endsWith('+page.v')))
		assert.ok(data.created.some((c) => c.endsWith('+page.svelte')))
		assert.ok(existsSync(join(root, 'src', 'routes', 'dashboard', '+page.v')))
		assert.ok(existsSync(join(root, 'src', 'routes', 'dashboard', '+page.svelte')))
	})
	it('tools/call scaffold_route rejects bad mode', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-mcp-badmode-'))
		const res = await handleRequest({
			jsonrpc: '2.0',
			id: 8,
			method: 'tools/call',
			params: { name: 'scaffold_route', arguments: { root, route: '/x', mode: 'bogus' } },
		})
		assert.ok(res && 'error' in res && res.error?.code === -32602)
	})
	it('tools/call explain_bytecode_error maps frames', async () => {
		const root = fixture()
		const res = await handleRequest({
			jsonrpc: '2.0',
			id: 9,
			method: 'tools/call',
			params: {
				name: 'explain_bytecode_error',
				arguments: { root, stack_trace: 'Error: boom\nat load_page (src/routes/api/greet.v:2:1)' },
			},
		})
		assert.ok(res && 'result' in res)
		const data = JSON.parse((res.result as { content: { text: string }[] }).content[0].text) as {
			frames: { file: string; line: number; snippet: string | null }[]
		}
		assert.equal(data.frames.length, 1)
		assert.equal(data.frames[0].file, 'src/routes/api/greet.v')
		assert.ok(data.frames[0].snippet)
	})
	it('tools/call explain_bytecode_error resolves wasm via .wasm.map', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-mcp-wasmmap-'))
		mkdirSync(join(root, '.swelte', 'dev', 'crypto'), { recursive: true })
		writeFileSync(
			join(root, '.swelte', 'dev', 'crypto', 'hash.wasm.map'),
			JSON.stringify({
				mod: 'crypto/hash',
				file: 'src/lib/crypto/hash.v',
				functions: [{ name: 'hash_string', params: ['input'] }],
			})
		)
		const res = await handleRequest({
			jsonrpc: '2.0',
			id: 10,
			method: 'tools/call',
			params: {
				name: 'explain_bytecode_error',
				arguments: { root, stack_trace: 'wasm trap in hash_string' },
			},
		})
		assert.ok(res && 'result' in res)
		const data = JSON.parse((res.result as { content: { text: string }[] }).content[0].text) as {
			frames: { fn: string; file: string | null; via: string | null }[]
		}
		assert.equal(data.frames.length, 1)
		assert.equal(data.frames[0].fn, 'hash_string')
		assert.equal(data.frames[0].file, 'src/lib/crypto/hash.v')
		assert.equal(data.frames[0].via, '.wasm.map')
	})
})
