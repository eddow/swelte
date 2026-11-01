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
	writeFileSync(join(root, 'package.json'), '{"name":"t"}')
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
		const root = rootWith({ 'src/routes/lonely.v': 'module l\n@[get] pub fn g() string { return "" }' })
		const diags = await collectDiagnostics(root)
		assert.ok(diags.some((d) => d.kind === 'orphan'))
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

	it('SSE shape stays out (documented subset)', async () => {
		const root = rootWith({
			'src/routes/+page.v': 'module p\n@[sse] pub fn t() string { return "" }',
		})
		const diags = await collectDiagnostics(root)
		assert.ok(!diags.some((d) => d.kind === 'sse'))
	})
})
