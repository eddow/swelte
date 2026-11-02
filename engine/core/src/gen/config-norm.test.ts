import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, loadConfig, renderClientEntry } from './config.js'

describe('config normalization (tmp roots)', () => {
	it('missing file -> defaults', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		const cfg = await loadConfig(root)
		assert.equal(cfg.routesDir, 'src/routes')
		assert.equal(cfg.libDir, 'src/lib')
		assert.equal(cfg.outDir, '.swelte')
		assert.equal(cfg.port, 8131)
	})

	it('swelte key read (defineConfig non-enumerable)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		const cfg0 = defineConfig({ swelte: { port: 9999 } })
		assert.ok(!Object.keys(cfg0).includes('swelte'))
		assert.equal((cfg0 as unknown as { swelte?: { port?: number } }).swelte?.port, 9999)
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { port: 4321 } }`
		)
		const cfg = await loadConfig(root)
		assert.equal(cfg.port, 4321)
	})

	it('legacy top-level swelte.config.ts read', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(join(root, 'swelte.config.ts'), `export default { port: 5555 }`)
		const cfg = await loadConfig(root)
		assert.equal(cfg.port, 5555)
	})

	it('broken config warns and falls back', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(join(root, 'svelte.config.js'), `this is not js (((`)
		const warns: string[] = []
		const orig = console.warn
		console.warn = (m?: unknown) => {
			warns.push(String(m))
		}
		try {
			const cfg = await loadConfig(root)
			assert.equal(cfg.port, 8131)
		} finally {
			console.warn = orig
		}
		assert.ok(warns.join('\n').includes('failed to load'))
	})

	it('sveltekit knobs normalize (trailingSlash/base/csp/csrf/methodOverride/version)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { trailingSlash: 'always', base: '/app', csp: "default-src 'self'", csrf: 'enforce', methodOverride: true, version: '1.2.3' } }`
		)
		const cfg = await loadConfig(root)
		assert.equal(cfg.trailingSlash, 'always')
		assert.equal(cfg.base, '/app')
		assert.equal(cfg.assets, '/app')
		assert.equal(cfg.csp, "default-src 'self'")
		assert.equal(cfg.csrf, 'enforce')
		assert.equal(cfg.methodOverride, true)
		assert.equal(cfg.version, '1.2.3')
	})

	it('serviceWorker defaults off, normalizes manual/auto', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		const off = await loadConfig(root)
		assert.equal(off.serviceWorker.enabled, false)
		assert.equal(off.serviceWorker.register, 'auto')
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { serviceWorker: { enabled: true, register: 'manual' } } }`
		)
		const on = await loadConfig(root)
		assert.equal(on.serviceWorker.enabled, true)
		assert.equal(on.serviceWorker.register, 'manual')
	})

	it('bad trailingSlash falls back to ignore', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(join(root, 'svelte.config.js'), `export default { swelte: { trailingSlash: 'sometimes' } }`)
		const cfg = await loadConfig(root)
		assert.equal(cfg.trailingSlash, 'ignore')
	})

	it('renderClientEntry prepends hook only when src/client.ts exists', async () => {
		const { templatesDir } = await import('./config.js')
		const fromUrl = import.meta.url
		void templatesDir
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		mkdirSync(join(root, 'src'), { recursive: true })
		const noHook = renderClientEntry(root, fromUrl)
		assert.ok(noHook.includes('Optional user hook'))
		writeFileSync(join(root, 'src', 'client.ts'), 'export {}')
		const hook = renderClientEntry(root, fromUrl)
		assert.ok(hook.startsWith(`import '../src/client.js'`))
	})
})
