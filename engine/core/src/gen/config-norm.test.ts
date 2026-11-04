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
		writeFileSync(join(root, 'svelte.config.js'), `export default { swelte: { port: 4321 } }`)
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
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { trailingSlash: 'sometimes' } }`
		)
		const cfg = await loadConfig(root)
		assert.equal(cfg.trailingSlash, 'ignore')
	})
	it('sveltekit remainder knobs normalize (prerender/isr/target/offline)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		const off = await loadConfig(root)
		assert.equal(off.prerender.entries, 'off')
		assert.equal(off.prerender.concurrency, 4)
		assert.deepEqual(off.isr, {})
		assert.equal(off.target, 'auto')
		assert.equal(off.targetOs, '')
		assert.equal(off.targetArch, '')
		assert.equal(off.offline.fallback, 'off')
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { prerender: { entries: 'all', concurrency: 2 }, isr: { '/blog': 60, '/x': -1 }, target: 'node', targetOs: 'macos', targetArch: 'arm64', offline: { fallback: true } } }`
		)
		const on = await loadConfig(root)
		assert.equal(on.prerender.entries, 'all')
		assert.equal(on.prerender.concurrency, 2)
		assert.deepEqual(on.isr, { '/blog': 60 })
		assert.equal(on.target, 'node')
		assert.equal(on.targetOs, 'macos')
		assert.equal(on.targetArch, 'arm64')
		assert.equal(on.offline.fallback, 'offline.html')
	})

	it('package.json swelte key is the config fallback (deploy target)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({ name: 'x', swelte: { targetOs: 'linux', targetArch: 'arm64' } })
		)
		// No svelte.config at all → package.json wins.
		const cfg = await loadConfig(root)
		assert.equal(cfg.targetOs, 'linux')
		assert.equal(cfg.targetArch, 'arm64')
		// svelte.config wins field-by-field; package fills only the gaps.
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { targetOs: 'macos' } }`
		)
		const merged = await loadConfig(root)
		assert.equal(merged.targetOs, 'macos')
		assert.equal(merged.targetArch, 'arm64')
	})

	it('cross-build targetOs/targetArch normalize (case-insensitive, aliases, bad -> host)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { targetOs: 'Windows', targetArch: 'X86_64' } }`
		)
		const cfg = await loadConfig(root)
		assert.equal(cfg.targetOs, 'windows')
		assert.equal(cfg.targetArch, 'amd64')
		const root2 = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(
			join(root2, 'svelte.config.js'),
			`export default { swelte: { targetOs: 'plan9', targetArch: 'riscv' } }`
		)
		const bad = await loadConfig(root2)
		assert.equal(bad.targetOs, '')
		assert.equal(bad.targetArch, '')
	})

	it('bad prerender/target/offline fall back to defaults', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(
			join(root, 'svelte.config.js'),
			`export default { swelte: { prerender: { entries: 'sometimes', concurrency: 0 }, target: 'vercel', offline: { fallback: 42 } } }`
		)
		const cfg = await loadConfig(root)
		assert.equal(cfg.prerender.entries, 'off')
		assert.equal(cfg.prerender.concurrency, 4)
		assert.equal(cfg.target, 'auto')
		assert.equal(cfg.offline.fallback, 'off')
	})

	it('chunking defaults to layout; env wins over config', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		const off = await loadConfig(root)
		assert.equal(off.chunking, 'layout')
		// One root per case: loadConfig cache-busts by ms timestamp, so two
		// writes in the same millisecond would read the first module.
		const root2 = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(
			join(root2, 'svelte.config.js'),
			`export default { swelte: { chunking: 'route' } }`
		)
		const on = await loadConfig(root2)
		assert.equal(on.chunking, 'route')
		const root3 = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		writeFileSync(
			join(root3, 'svelte.config.js'),
			`export default { swelte: { chunking: 'sometimes' } }`
		)
		const bad = await loadConfig(root3)
		assert.equal(bad.chunking, 'layout')
		process.env.SWELTE_CHUNKING = 'single'
		try {
			const env = await loadConfig(root2)
			assert.equal(env.chunking, 'single')
		} finally {
			delete process.env.SWELTE_CHUNKING
		}
	})

	it('renderClientEntry pulls src/app.ts + src/app.css via .js specifiers (no allowImportingTsExtensions)', async () => {
		const { templatesDir } = await import('./config.js')
		const fromUrl = import.meta.url
		void templatesDir
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		mkdirSync(join(root, 'src'), { recursive: true })
		const none = renderClientEntry(root, fromUrl)
		assert.ok(none.includes('Optional user hook'))
		writeFileSync(join(root, 'src', 'app.ts'), 'export {}')
		writeFileSync(join(root, 'src', 'app.css'), ':root{}')
		const hook = renderClientEntry(root, fromUrl)
		assert.ok(hook.startsWith(`import '../src/app.js'`))
		assert.ok(hook.includes(`import '../src/app.css'`))
		assert.ok(!hook.includes(`import '../src/client.js'`))
	})

	it('renderClientEntry honors legacy src/client.ts when app.ts is absent', async () => {
		const { templatesDir } = await import('./config.js')
		const fromUrl = import.meta.url
		void templatesDir
		const root = mkdtempSync(join(tmpdir(), 'swelte-cfg-'))
		mkdirSync(join(root, 'src'), { recursive: true })
		writeFileSync(join(root, 'src', 'client.ts'), 'export {}')
		const hook = renderClientEntry(root, fromUrl)
		assert.ok(hook.startsWith(`import '../src/client.js'`))
	})
})
