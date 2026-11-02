import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function scaffold(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-gen-'))
	mkdirSync(join(root, 'src', 'routes'), { recursive: true })
	mkdirSync(join(root, 'src', 'lib'), { recursive: true })
	writeFileSync(join(root, 'package.json'), '{"name":"t"}')
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
			'+page.v': 'module p\n@[rpc] pub fn f(args LoginArgs) !SwelteResponse { return SwelteResponse{} }',
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
		writeFileSync(join(root, 'src', 'app.v'), 'module s\n@[startup]\npub fn a() { }\n@[startup]\npub fn b() { }')
		await assert.rejects(() => buildStart(root), /two @\[startup\] fns/)
		// @[reroute] wrong shape → build error.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(join(root, 'src', 'app.v'), 'module s\n@[reroute]\npub fn r(host string) string { return host }')
		await assert.rejects(() => buildStart(root), /must take \(host string, path string\)/)
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(join(root, 'src', 'app.v'), 'module s\n@[reroute]\npub fn r(host string, path string) bool { return true }')
		await assert.rejects(() => buildStart(root), /must return string/)
		// Happy path: startup + reroute inline into the harness.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			"module s\n@[startup]\npub fn init() {\n\tprintln('boot')\n}\n@[reroute]\npub fn rw(host string, path string) string {\n\tif host.starts_with('bills.') {\n\t\treturn '/bills'\n\t}\n\treturn ''\n}"
		)
		await buildStart(root)
		const sv = readFileSync(join(root, '.swelte', 'server.v'), 'utf8')
		assert.ok(sv.includes("@[startup] (src/app.v)"), sv.slice(0, 500))
		assert.ok(sv.includes("println('boot')"), sv.slice(0, 2000))
		assert.ok(sv.includes('@[reroute] (src/app.v)'), sv.slice(0, 5000))
		assert.ok(sv.includes("starts_with('bills.')"), sv.slice(0, 8000))
		assert.ok(sv.includes("if rerouted != '' { path = rerouted }"), sv.slice(0, 8000))
	})

	it('cron hooks: validation + spawn-loop codegen', async () => {
		const { readFileSync, writeFileSync } = await import('node:fs')
		// Missing qualifier -> build error.
		let root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(join(root, 'src', 'app.v'), 'module s\n@[cron]\npub fn tick() { }')
		await assert.rejects(() => buildStart(root), /needs a duration qualifier/)
		// Bad duration -> build error.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(join(root, 'src', 'app.v'), "module s\n@[cron('daily')]\npub fn tick() { }")
		await assert.rejects(() => buildStart(root), /bad duration/)
		// Params -> build error.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(join(root, 'src', 'app.v'), "module s\n@[cron('60s')]\npub fn tick(n int) { }")
		await assert.rejects(() => buildStart(root), /takes no params/)
		// Non-void return -> build error.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(join(root, 'src', 'app.v'), "module s\n@[cron('60s')]\npub fn tick() string { return '' }")
		await assert.rejects(() => buildStart(root), /must return void/)
		// Misplaced @[cron] in routes -> build error.
		root = scaffold({
			'+page.v': 'module p\n@[cron(\'60s\')]\npub fn tick() { }\n@[get] pub fn g() string { return "" }',
		})
		writeFileSync(join(root, 'src', 'app.v'), 'module s')
		await assert.rejects(() => buildStart(root), /only allowed in its own file/)
		// Happy path: plain + fallible crons -> two loops, distinct sleeps.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		writeFileSync(
			join(root, 'src', 'app.v'),
			"module s\n@[cron('60s')]\npub fn tick() {\n\tprintln('tick')\n}\n@[cron('5m')]\npub fn sweep() !void {\n\tprintln('sweep')\n}"
		)
		await buildStart(root)
		const sv = readFileSync(join(root, '.swelte', 'server.v'), 'utf8')
		assert.ok(sv.includes('@[cron] (src/app.v)'))
		assert.ok(sv.includes("println('tick')"))
		assert.ok(sv.includes("println('sweep')"))
		assert.ok(sv.includes('time.sleep(60 * time.second)'))
		assert.ok(sv.includes('time.sleep(300 * time.second)'))
		assert.ok(sv.includes('spawn swelte_cron_loop_1()'))
		assert.ok(sv.includes('spawn swelte_cron_loop_2()'))
		assert.ok(sv.includes('fn swelte_cron_1() {'))
		assert.ok(sv.includes('fn swelte_cron_2() !void {'))
		assert.ok(sv.includes("eprintln('[swelte:cron] ' + err.msg())"))
	
		// No hooks → harness byte-identical to the template skeleton.
		root = scaffold({ '+page.v': 'module p\n@[get] pub fn g() string { return "" }' })
		await buildStart(root)
		const { renderHarness, templatesDir } = await import('./gen/config.js')
		const { readFileSync: rf } = await import('node:fs')
		const { join: jn } = await import('node:path')
		const skeleton = rf(jn(templatesDir(import.meta.url), 'harness', 'server.v'), 'utf8')
		assert.equal(readFileSync(join(root, '.swelte', 'server.v'), 'utf8'), skeleton)
	})
})
