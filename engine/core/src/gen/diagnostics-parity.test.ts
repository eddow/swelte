import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDiagnostics } from './diagnostics.js'

function rootWith(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-diag-'))
	mkdirSync(join(root, 'src', 'routes'), { recursive: true })
	mkdirSync(join(root, 'src', 'lib'), { recursive: true })
	writeFileSync(join(root, 'package.json'), '{"name":"t","type":"module"}')
	writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
	for (const [rel, src] of Object.entries(files)) {
		const abs = join(root, rel)
		mkdirSync(join(abs, '..'), { recursive: true })
		writeFileSync(abs, src)
	}
	return root
}

describe('diagnostics parity (tmp fixtures)', () => {
	it('orphan route', async () => {
		// Orphan = a page-shaped leaf (@[load] paints HTML) with no .svelte
		// partner. Verb-only leaves are JSON endpoints, not orphans.
		const root = rootWith({
			'src/routes/lonely.v':
				'module l\n@[load] pub fn load_home(req SwelteRequest) string { return "" }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(diags.some((d) => d.kind === 'orphan'))
	})

	it('verb-only leaf is not an orphan (JSON endpoint)', async () => {
		const root = rootWith({
			'src/routes/ping.v': 'module l\n@[get] pub fn g() string { return "" }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(!diags.some((d) => d.kind === 'orphan'))
	})

	it('folder clash (foo.v vs foo/+page.v)', async () => {
		const root = rootWith({
			'src/routes/foo.v': 'module f\n@[get] pub fn g() string { return "" }',
			'src/routes/foo/+page.v': 'module p\n@[get] pub fn h() string { return "" }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(diags.some((d) => d.kind === 'clash'))
	})

	it('unknown V type', async () => {
		const root = rootWith({
			'src/routes/+page.v': 'module p\n@[get] pub fn g(x chan int) string { return "" }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(diags.some((d) => d.kind === 'type'))
	})

	it('ignored #lib attr', async () => {
		const root = rootWith({
			'src/routes/+page.v': 'module p\n@[get] pub fn g() string { return "" }',
			'src/lib/u.v': 'module u\n@[get] pub fn g() string { return "" }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(diags.some((d) => d.kind === 'attr'))
	})

	it('backend/ TS file', async () => {
		const root = rootWith({
			'src/routes/+page.v': 'module p\n@[get] pub fn g() string { return "" }',
			'src/lib/backend/x.ts': 'export const a = 1',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(diags.some((d) => d.kind === 'backend-ts'))
	})

	it('framework singletons are not stray (src/app.v + matchers.v)', async () => {
		const root = rootWith({
			'src/routes/+page.v': 'module p\n@[get] pub fn g() string { return "" }',
			'src/app.v': 'module app\n@[startup]\npub fn boot() {\n}',
			'src/matchers.v': 'module matchers\n@[matcher]\npub fn slug(s string) bool { return true }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(!diags.some((d) => d.kind === 'stray'))
	})

	it('SSE shape stays out (documented subset)', async () => {
		const root = rootWith({
			'src/routes/+page.v': 'module p\n@[sse] pub fn t() string { return "" }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(!diags.some((d) => d.kind === 'sse'))
	})
})
