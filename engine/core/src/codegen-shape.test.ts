import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function scaffold(): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-golden-'))
	mkdirSync(join(root, 'src', 'routes', 'api'), { recursive: true })
	mkdirSync(join(root, 'src', 'routes', 'admin'), { recursive: true })
	mkdirSync(join(root, 'src', 'lib'), { recursive: true })
	writeFileSync(join(root, 'package.json'), '{"name":"t"}')
	writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
	writeFileSync(
		join(root, 'src', 'routes', 'api', 'greet.v'),
		`module api_greet
pub struct LoginArgs {
pub:
	payload string
}
@[rpc]
@[sets_cookie]
pub fn login(args LoginArgs) !string {
	return args.payload
}
@[get]
pub fn hello(name string) string {
	return name
}
@[sse]
pub fn tick(emit fn (string) bool) {
}`
	)
	writeFileSync(
		join(root, 'src', 'lib', 'util.v'),
		`module util
@[rpc]
pub fn add(a int, b int) int {
	return a + b
}`
	)
	return root
}

async function generate(root: string): Promise<void> {
	const { swelte } = await import('./vite.js')
	const plug = swelte({}) as unknown as {
		configResolved?: (c: { root: string }) => void
		buildStart?: () => Promise<void>
	}
	plug.configResolved?.({ root })
	await plug.buildStart?.()
}

function tree(root: string, dir: string): string[] {
	const out: string[] = []
	const walk = (d: string, rel: string) => {
		for (const e of readdirSync(d).sort()) {
			const p = join(d, e)
			if (statSync(p).isDirectory()) walk(p, rel + e + '/')
			else out.push(rel + e)
		}
	}
	walk(join(root, dir), '')
	return out
}

describe('codegen shape snapshots (fetch/SSE/dispatcher)', () => {
	it('dispatcher contains swelte_route + sse + load entry points', async () => {
		const root = scaffold()
		await generate(root)
		const disp = readFileSync(join(root, '.swelte', 'routes', 'server_gen.v'), 'utf8')
		assert.ok(disp.includes('pub fn swelte_route('))
		assert.ok(disp.includes('pub fn swelte_sse_route('))
		assert.ok(disp.includes('pub fn swelte_load_for('))
	})

	it('fetch stub has dyn params + SSE generator + qualifier plumbing', async () => {
		const root = scaffold()
		mkdirSync(join(root, 'src', 'routes', 'users'), { recursive: true })
		writeFileSync(
			join(root, 'src', 'routes', 'users', '[id].v'),
			`module u\n@[get('q')] pub fn g() string { return '' }\n@[sse] pub fn tick(emit fn (string) bool) {}`
		)
		await generate(root)
		const stub = readFileSync(join(root, '.swelte', 'generated', 'routes', 'users', '[id].js'), 'utf8')
		assert.ok(stub.includes('__swelteUrl'))
		assert.ok(stub.includes('async function *'))
		assert.ok(stub.includes('__swelteStream'))
		assert.ok(stub.includes(`"q"`))
	})

	it('wasm stub references __swelteWasmCall + wasm url', async () => {
		const root = scaffold()
		await generate(root)
		const stub = readFileSync(join(root, '.swelte', 'generated', 'lib', 'util.js'), 'utf8')
		assert.ok(stub.includes('__swelteWasmCall'))
		assert.ok(stub.includes('.wasm'))
	})

	it('rerun is byte-identical (order-stable)', async () => {
		const root = scaffold()
		await generate(root)
		const snap1 = tree(root, '.swelte')
			.map((f) => f + '\n' + readFileSync(join(root, '.swelte', f), 'utf8'))
			.join('\n====\n')
		await generate(root)
		const snap2 = tree(root, '.swelte')
			.map((f) => f + '\n' + readFileSync(join(root, '.swelte', f), 'utf8'))
			.join('\n====\n')
		assert.equal(snap2, snap1)
	})

	it('ssr-manifest lists svelte pages; headless api stays out of entries', async () => {
		const root = scaffold()
		mkdirSync(join(root, 'src', 'routes', 'admin'), { recursive: true })
		writeFileSync(join(root, 'src', 'routes', 'admin', '+page.svelte'), '<h1>a</h1>')
		writeFileSync(
			join(root, 'src', 'routes', 'admin', '+page.v'),
			'module p\n@[get] pub fn g() string { return "" }'
		)
		await generate(root)
		const mf = JSON.parse(readFileSync(join(root, '.swelte', 'ssr-manifest.json'), 'utf8'))
		assert.ok(Array.isArray(mf.routes))
		// api/greet.v has no .svelte partner (headless JSON): manifest is
		// svelte-driven, so it is excluded from page entries.
		assert.ok(!mf.routes.some((r: { route: string }) => r.route === '/api/greet'))
		const admin = mf.routes.find((r: { route: string }) => r.route === '/admin')
		assert.ok(admin)
		assert.equal(admin.hasData, true)
	})
})
