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
})
