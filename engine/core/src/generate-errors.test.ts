import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function scaffold(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-gen-'))
	mkdirSync(join(root, 'src', 'routes'), { recursive: true })
	mkdirSync(join(root, 'src', 'lib'), { recursive: true })
	writeFileSync(join(root, 'package.json'), '{"name":"t","type":"module"}')
	writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
	for (const [rel, src] of Object.entries(files)) {
		mkdirSync(join(root, 'src', 'routes', rel.split('/').slice(0, -1).join('/')), {
			recursive: true,
		})
		writeFileSync(join(root, 'src', 'routes', rel), src)
	}
	return root
}

async function buildStart(root: string): Promise<void> {
	const { swelte } = await import('./vite.js')
	const plug = swelte({}) as unknown as {
		configResolved?: (c: { root: string }) => void
		buildStart?: () => Promise<void>
	}
	plug.configResolved?.({ root })
	await plug.buildStart?.()
}

describe('generate() validation errors (tmp scaffold, no V binary)', () => {
	it('@[rpc] with SwelteRequest param throws (protocol-ignorant)', async () => {
		const root = scaffold({
			'+page.v': 'module p\n@[rpc] pub fn f(req SwelteRequest) string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /protocol-ignorant/)
	})

	it('@[rpc] with SwelteResponse return throws', async () => {
		const root = scaffold({
			'+page.v':
				'module p\n@[rpc] pub fn f(args LoginArgs) !SwelteResponse { return SwelteResponse{} }',
		})
		await assert.rejects(() => buildStart(root), /typed values/)
	})

	it('@[rpc] with []u8 return throws (use a verb)', async () => {
		const root = scaffold({
			'+page.v': 'module p\n@[rpc] pub fn f(args LoginArgs) []u8 { return []u8{} }',
		})
		await assert.rejects(() => buildStart(root), /use a verb/)
	})

	it('@[get] with non-HTTP return throws', async () => {
		const root = scaffold({
			'+page.v': 'module p\n@[get] pub fn g() chan int { return chan int{} }',
		})
		await assert.rejects(() => buildStart(root), /verbs are HTTP/)
	})
	it('wrong middleware signature throws (before: one SwelteRequest)', async () => {
		const root = scaffold({
			'+route.v': 'module r\n@[before] pub fn b(x int, y string) !SwelteRequest { return "" }',
			'+page.v': 'module p\n@[get] pub fn g() string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /must take exactly one SwelteRequest/)
	})

	it('@[after] wrong params shape throws (validated before return)', async () => {
		const root = scaffold({
			'+route.v': 'module r\n@[after] pub fn a(x int) int { return 1 }',
			'+page.v': 'module p\n@[get] pub fn g() string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /must take/)
	})

	it('middleware in a leaf file throws (only +route.v)', async () => {
		const root = scaffold({
			'+page.v':
				'module p\n@[before] pub fn b(req SwelteRequest) !SwelteRequest { return req }\n@[get] pub fn g() string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /only allowed in \+route\.v/)
	})

	it('two @[load] in one file throws', async () => {
		const root = scaffold({
			'+page.v':
				'module p\n@[load] pub fn a(req SwelteRequest) !string { return "" }\n@[load] pub fn b(req SwelteRequest) !string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /one loader per file/)
	})

	it('@[load] stacked with verb throws', async () => {
		const root = scaffold({
			'+page.v': 'module p\n@[load; get] pub fn a(req SwelteRequest) !string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /one transport per fn/)
	})

	it('two @[get] defaults in one file throws', async () => {
		const root = scaffold({
			'+page.v':
				'module p\n@[get] pub fn a() string { return "" }\n@[get] pub fn b() string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /one default per verb per file/)
	})

	it('duplicate @[get(q)] qualifier throws', async () => {
		const root = scaffold({
			'+page.v': `module p\n@[get('q')] pub fn a() string { return "" }\n@[get('q')] pub fn b() string { return "" }`,
		})
		await assert.rejects(() => buildStart(root), /duplicate @\[get\('q'\)\]/)
	})

	it('@[matcher] in a routes file throws (only src/matchers.v)', async () => {
		const root = scaffold({
			'+page.v':
				'module p\n@[matcher] pub fn slug(s string) bool { return true }\n@[get] pub fn g() string { return "" }',
		})
		await assert.rejects(() => buildStart(root), /only allowed in its own file/)
	})

	it('server hooks: shape errors + happy-path codegen', async () => {
		const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
		// Two @[startup] → build error.
		let root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			'module s\n@[startup]\npub fn a() { }\n@[startup]\npub fn b() { }'
		)
		await assert.rejects(() => buildStart(root), /two @\[startup\] fns/)
		// @[reroute] wrong shape → build error.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			'module s\n@[reroute]\npub fn r(host string) string { return host }'
		)
		await assert.rejects(() => buildStart(root), /must take \(host string, path string\)/)
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			'module s\n@[reroute]\npub fn r(host string, path string) bool { return true }'
		)
		await assert.rejects(() => buildStart(root), /must return string/)
		// Happy path: startup + reroute inline into the harness.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			"module s\n@[startup]\npub fn init() {\n\tprintln('boot')\n}\n@[reroute]\npub fn rw(host string, path string) string {\n\tif host.starts_with('bills.') {\n\t\treturn '/bills'\n\t}\n\treturn ''\n}"
		)
		await buildStart(root)
		const sv = readFileSync(join(root, '.swelte', 'server.v'), 'utf8')
		assert.ok(sv.includes('@[startup] (src/app.v)'), sv.slice(0, 500))
		assert.ok(sv.includes("println('boot')"), sv.slice(0, 2000))
		assert.ok(sv.includes('@[reroute] (src/app.v)'), sv.slice(0, 5000))
		assert.ok(sv.includes("starts_with('bills.')"), sv.slice(0, 8000))
		assert.ok(sv.includes("if rerouted != '' { path = rerouted }"), sv.slice(0, 8000))
	})

	it('unregistered attrs parse to nothing (plugins register via extraAttrs)', async () => {
		const { readFileSync, writeFileSync } = await import('node:fs')
		const { parseVFile } = await import('./vite/parse.js')
		// No plugin loaded: `@[cron]` is not a core attr, so the parser drops
		// the fn entirely (same as any typo'd attr) — core output stays inert.
		assert.deepEqual(
			parseVFile('module s\n@[cron]\npub fn tick() { }').map((f) => f.attr),
			[]
		)
		// The owning plugin registers it: fn parses with body for inlining.
		assert.deepEqual(
			parseVFile('module s\n@[cron]\npub fn tick() { }', ['cron']).map((f) => f.attr),
			['cron']
		)
		let root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(join(root, 'src', 'app.v'), 'module s\n@[cron]\npub fn tick() { }')
		await buildStart(root)
		const svCron = readFileSync(join(root, '.swelte', 'server.v'), 'utf8')
		assert.ok(
			!svCron.includes('swelte_cron'),
			'core must emit no cron loops without the owning plugin'
		)
		// Unregistered @[cron] in routes → dropped at parse, route still builds.
		root = scaffold({
			'+page.v':
				'module p\n@[cron(\'60s\')]\npub fn tick() { }\n@[get] pub fn g() string { return "" }',
		})
		writeFileSync(join(root, 'src', 'app.v'), 'module s')
		await buildStart(root)
		assert.ok(
			!readFileSync(join(root, '.swelte', 'server.v'), 'utf8').includes('swelte_cron'),
			'unregistered cron in routes must stay inert'
		)
		// Misplaced core hook in routes → own-file guard rejects before dispatch.
		root = scaffold({
			'+page.v': 'module p\n@[startup]\npub fn boot() { }\n@[get] pub fn g() string { return "" }',
		})
		writeFileSync(join(root, 'src', 'app.v'), 'module s')
		await assert.rejects(() => buildStart(root), /only allowed in its own file/)
		// No hooks → harness byte-identical to the template skeleton.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		await buildStart(root)
		const { renderHarness, templatesDir } = await import('./gen/config.js')
		const { readFileSync: rf } = await import('node:fs')
		const { join: jn } = await import('node:path')
		const skeleton = rf(jn(templatesDir(import.meta.url), 'harness', 'server.v'), 'utf8')
		assert.equal(readFileSync(join(root, '.swelte', 'server.v'), 'utf8'), skeleton)
	})

	it('@[error] hook: validation + sanitize-fn codegen', async () => {
		const { writeFileSync } = await import('node:fs')
		// Wrong params -> build error.
		let root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			'module s\n@[error]\npub fn oops(msg string) string { return msg }'
		)
		await assert.rejects(() => buildStart(root), /must take \(message string, status int\)/)
		// Non-string return -> build error.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			'module s\n@[error]\npub fn oops(message string, status int) void { }'
		)
		await assert.rejects(() => buildStart(root), /must return string/)
		// Two @[error] fns -> build error.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			'module s\n@[error]\npub fn a(message string, status int) string { return "" }\n@[error]\npub fn b(message string, status int) string { return "" }'
		)
		await assert.rejects(() => buildStart(root), /two @\[error\] fns/)
		// Happy path: sanitizer body replaces the default fn.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			"module s\n@[error]\npub fn scrub(message string, status int) string {\n\tif status >= 500 { return 'internal error' }\n\treturn ''\n}"
		)
		await buildStart(root)
		const { readFileSync: rf2 } = await import('node:fs')
		const sv = rf2(join(root, '.swelte', 'server.v'), 'utf8')
		assert.ok(sv.includes('@[error] (src/app.v)'), sv.slice(0, 4000))
		assert.ok(sv.includes("return 'internal error'"), sv.slice(0, 8000))
		assert.ok(sv.includes('fn swelte_sanitize_error(message string, status int) string {'))
	})

	it('P0 item 3: server_gen emits IError-typed helpers (status preservation)', async () => {
		const { emitServerGen } = await import('./vite/server-gen.js')
		const gen = emitServerGen(
			[{ route: '/plain', mod: 'plain', prefix: 'r_' }],
			new Set(),
			new Map(),
			[],
			[],
			[]
		)
		// SwelteError implements IError (msg/code) so `return swelte_error(..)`
		// compiles as a !T throw; err_typed keeps >=400 statuses, err_bad
		// keeps the 400 default for plain throws.
		assert.ok(gen.includes('pub fn (e SwelteError) msg() string {'))
		assert.ok(gen.includes('pub fn (e SwelteError) code() int {'))
		assert.ok(
			gen.includes('fn swelte_err_typed(path string, fn_name string, err IError) SwelteResponse {')
		)
		assert.ok(gen.includes('fn swelte_load_err_typed(err IError) SwelteLoadResult {'))
		assert.ok(gen.includes('SwelteLoadResult{ status: st,'), gen.slice(0, 6000))
	})

	it('P1 items 6+12: server_gen emits swelte_no_csr + swelte_route_limits', async () => {
		const { emitServerGen } = await import('./vite/server-gen.js')
		const gen = emitServerGen(
			[{ route: '/plain', mod: 'plain', prefix: 'r_' }],
			new Set(),
			new Map(),
			[],
			['/plain'],
			[
				{
					route: '/limited',
					limits: { rate: 10, rateWindowMs: 60000, timeoutMs: 5000, bodyLimit: 1048576 },
				},
			]
		)
		assert.ok(gen.includes('pub fn swelte_no_csr(path string) bool {'), gen.slice(0, 2000))
		assert.ok(gen.includes('if norm_path == "/plain" { return true }'))
		assert.ok(gen.includes('pub struct SwelteRouteLimits {'))
		assert.ok(
			gen.includes(
				'out << SwelteRouteLimits{ route: "/limited", rate: 10, rate_window_ms: 60000, timeout_ms: 5000, body_limit: 1048576 }'
			)
		)
		// Empty lists keep the predicates total (no-route fallback).
		const empty = emitServerGen([], new Set(), new Map(), [], [], [])
		assert.ok(empty.includes('pub fn swelte_no_csr(path string) bool {'))
		assert.ok(empty.includes('mut out := []SwelteRouteLimits{}'))
		assert.ok(empty.includes('mut out := []SwelteRouteSerializedHeaders{}'))
	})

	it('P2 serializedHeaders: server_gen emits the allowlist table', async () => {
		const { emitServerGen } = await import('./vite/server-gen.js')
		const gen = emitServerGen(
			[],
			new Set(),
			new Map(),
			[],
			[],
			[],
			[
				{ route: '/shop', headers: ['x-foo', 'X-Bar'] },
				{ route: '/empty', headers: [] },
			]
		)
		assert.ok(gen.includes('pub struct SwelteRouteSerializedHeaders {'))
		assert.ok(
			gen.includes(
				'out << SwelteRouteSerializedHeaders{ route: "/shop", names: ["x-foo", "X-Bar"] }'
			)
		)
		assert.ok(
			gen.includes('out << SwelteRouteSerializedHeaders{ route: "/empty", names: []string{} }')
		)
		// Shared predicate: dynamic rows route through swelte_match_route so
		// `/users/[id]` hints fire for `/users/42` (static rows keep
		// exact-or-prefix). Emitted once, used by both tables.
		assert.ok(gen.includes('pub fn swelte_route_hit(row_route string, path string) bool {'))
		assert.ok(gen.includes("if row_route.contains('[') {"))
		assert.ok(gen.includes('m, _ := swelte_match_route(row_route, norm)'))
	})

	it('P2 serializedHeaders: hint validation + leaf-over-wrapper precedence', async () => {
		const { assertSerializedHeadersHint, collectSvelteManifest } = await import('./vite.js')
		assert.deepEqual(
			assertSerializedHeadersHint('f', `export const serializedHeaders = ['x-a', "X-B2"]`),
			['x-a', 'X-B2']
		)
		assert.deepEqual(assertSerializedHeadersHint('f', `export const serializedHeaders = []`), [])
		assert.equal(assertSerializedHeadersHint('f', `export const x = 1`), null)
		// Typed declarations parse — and a bad typed one still errors instead
		// of silently failing open (no filter = all headers pass).
		assert.deepEqual(
			assertSerializedHeadersHint('f', `export const serializedHeaders: string[] = ['x-typed']`),
			['x-typed']
		)
		assert.throws(
			() => assertSerializedHeadersHint('f', `export const serializedHeaders: string[] = 'x-a'`),
			/bad serializedHeaders hint/
		)
		assert.throws(
			() => assertSerializedHeadersHint('f', `export const serializedHeaders = ['x ok']`),
			/bad serializedHeaders hint/
		)
		assert.throws(
			() => assertSerializedHeadersHint('f', `export const serializedHeaders = 'x-a'`),
			/bad serializedHeaders hint/
		)
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-serh-'))
		mkdirSync(join(root, 'src', 'routes', 'admin', 'users'), { recursive: true })
		writeFileSync(join(root, 'src', 'routes', 'admin', '+route.svelte'), '<slot />')
		writeFileSync(
			join(root, 'src', 'routes', 'admin', '+route.ts'),
			`export const serializedHeaders = ['x-wrap']`
		)
		writeFileSync(join(root, 'src', 'routes', 'admin', 'users', '+page.svelte'), '<h1>u</h1>')
		writeFileSync(
			join(root, 'src', 'routes', 'admin', 'users', '+page.ts'),
			`export const serializedHeaders = ['x-leaf']`
		)
		// The manifest resolves leaf hints with fallback to the nearest
		// ancestor +route.ts; plugin.ts threads them into server_gen.
		const { entries } = collectSvelteManifest(join(root, 'src', 'routes'), 'src/routes', new Set())
		const by = (svelte: string) => entries.find((e) => e.svelte === svelte)
		assert.deepEqual(by('admin/+route.svelte')?.serializedHeaders, ['x-wrap'])
		assert.deepEqual(by('admin/users/+page.svelte')?.serializedHeaders, ['x-leaf'])
	})

	it('P2 serializedHeaders: wrapper hint covers hint-less leaves in the subtree', async () => {
		const { collectSvelteManifest } = await import('./vite.js')
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-serhwrap-'))
		mkdirSync(join(root, 'src', 'routes', 'admin', 'users'), { recursive: true })
		writeFileSync(join(root, 'src', 'routes', 'admin', '+route.svelte'), '<slot />')
		writeFileSync(
			join(root, 'src', 'routes', 'admin', '+route.ts'),
			`export const serializedHeaders = ['x-wrap']`
		)
		writeFileSync(join(root, 'src', 'routes', 'admin', 'users', '+page.svelte'), '<h1>u</h1>')
		const { entries } = collectSvelteManifest(join(root, 'src', 'routes'), 'src/routes', new Set())
		const page = entries.find((e) => e.svelte === 'admin/users/+page.svelte')
		assert.deepEqual(page?.serializedHeaders, ['x-wrap'])
	})

	it('P2 serializedHeaders: leaf inherits from its own directory wrapper', async () => {
		const { collectSvelteManifest } = await import('./vite.js')
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-serhown-'))
		mkdirSync(join(root, 'src', 'routes', 'admin'), { recursive: true })
		writeFileSync(join(root, 'src', 'routes', 'admin', '+route.svelte'), '<slot />')
		writeFileSync(
			join(root, 'src', 'routes', 'admin', '+route.ts'),
			`export const serializedHeaders = ['x-own']`
		)
		writeFileSync(join(root, 'src', 'routes', 'admin', '+page.svelte'), '<h1>a</h1>')
		// `admin/+route.svelte` wraps `admin/+page.svelte`, so its hint is
		// the nearest one — same-dir wrappers count, not just ancestors.
		const { entries } = collectSvelteManifest(join(root, 'src', 'routes'), 'src/routes', new Set())
		const page = entries.find((e) => e.svelte === 'admin/+page.svelte')
		assert.deepEqual(page?.serializedHeaders, ['x-own'])
	})
})
