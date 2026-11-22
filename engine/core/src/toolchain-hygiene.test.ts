import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	assertTargetArch,
	assertTargetOs,
	bridgeLinkedArchives,
	ensureSqliteForBuild,
	hasRealBridge,
	hasSystemSqlite,
	healDanglingBridge,
	hostTargetArch,
	hostTargetOs,
	needsGlobals,
	needsQjsLink,
	needsSqliteAmalgamation,
	normalizeTargetArch,
	normalizeTargetOs,
	resolveCC,
	resolveHostCC,
	resolveTargetArch,
	resolveTargetOs,
	sanitizedPath,
	toolchainEnv,
	vArchArgs,
	vOsArgs,
	zigTargetTriple,
} from './toolchain.js'

describe('toolchain PATH hygiene', () => {
	it('strips conda/miniconda/mamba (case-insensitive)', () => {
		const p = sanitizedPath('/opt/miniconda3/bin:/usr/bin:/opt/Mamba/bin:/usr/local/bin')
		assert.ok(!p.toLowerCase().includes('conda'))
		assert.ok(!p.toLowerCase().includes('mamba'))
		assert.ok(p.includes('/usr/bin'))
	})

	it('drops empties', () => {
		assert.equal(sanitizedPath('/usr/bin::/bin:'), '/usr/bin:/bin')
	})

	it('conda-only PATH falls back to system dirs', () => {
		const p = sanitizedPath('/opt/miniconda3/bin')
		assert.ok(p.includes('/usr/bin'))
	})

	it('toolchainEnv preserves extra vars', () => {
		const env = toolchainEnv({ FOO: 'bar' })
		assert.equal(env.FOO, 'bar')
		assert.ok(typeof env.PATH === 'string')
	})
})

describe('cross-build target OS (docs/cli.md)', () => {
	it('hostTargetOs maps process.platform to V -os vocabulary', () => {
		const host = hostTargetOs()
		assert.ok(host === 'linux' || host === 'macos' || host === 'windows')
	})

	it('normalizeTargetOs is lenient (config never throws)', () => {
		assert.equal(normalizeTargetOs('linux'), 'linux')
		assert.equal(normalizeTargetOs('MacOS'), 'macos')
		assert.equal(normalizeTargetOs(' WINDOWS '), 'windows')
		assert.equal(normalizeTargetOs(''), '')
		assert.equal(normalizeTargetOs(undefined), '')
		assert.equal(normalizeTargetOs('plan9'), '')
	})

	it('assertTargetOs is strict (CLI/env report bad values)', () => {
		assert.equal(assertTargetOs('macos', 'x'), 'macos')
		assert.equal(assertTargetOs('LINUX', 'x'), 'linux')
		assert.throws(() => assertTargetOs('plan9', '--target-os'), /want linux\|macos\|windows/)
	})

	it('resolveTargetOs precedence: CLI > env > config > host', () => {
		assert.equal(resolveTargetOs({ cli: 'windows', env: 'linux', config: 'macos' }), 'windows')
		assert.equal(resolveTargetOs({ cli: '', env: 'linux', config: 'macos' }), 'linux')
		assert.equal(resolveTargetOs({ cli: '', env: '', config: 'macos' }), 'macos')
		assert.equal(resolveTargetOs({ cli: '', env: '', config: '' }), '')
		assert.equal(resolveTargetOs({}), '')
		assert.throws(() => resolveTargetOs({ cli: 'plan9' }), /invalid --target-os/)
		assert.throws(() => resolveTargetOs({ cli: '', env: 'plan9' }), /invalid SWELTE_TARGET_OS/)
		// bad config falls back to host, never throws
		assert.equal(resolveTargetOs({ cli: '', env: '', config: 'plan9' }), '')
	})

	it('vOsArgs shapes the v -o flag slice (host = no flag)', () => {
		assert.deepEqual(vOsArgs(''), [])
		assert.deepEqual(vOsArgs(undefined), [])
		assert.deepEqual(vOsArgs('linux'), ['-os', 'linux'])
		assert.deepEqual(vOsArgs('macos'), ['-os', 'macos'])
		assert.deepEqual(vOsArgs('windows'), ['-os', 'windows'])
	})

	it('hostTargetArch maps process.arch to V -arch vocabulary', () => {
		const host = hostTargetArch()
		assert.ok(host === 'amd64' || host === 'arm64')
	})

	it('normalizeTargetArch is lenient (aliases + case-insensitive, bad -> host)', () => {
		assert.equal(normalizeTargetArch('amd64'), 'amd64')
		assert.equal(normalizeTargetArch('X64'), 'amd64')
		assert.equal(normalizeTargetArch('x86_64'), 'amd64')
		assert.equal(normalizeTargetArch('AARCH64'), 'arm64')
		assert.equal(normalizeTargetArch('arm64'), 'arm64')
		assert.equal(normalizeTargetArch(''), '')
		assert.equal(normalizeTargetArch(undefined), '')
		assert.equal(normalizeTargetArch('riscv'), '')
	})

	it('assertTargetArch is strict (CLI/env report bad values)', () => {
		assert.equal(assertTargetArch('arm64', 'x'), 'arm64')
		assert.equal(assertTargetArch('X86_64', 'x'), 'amd64')
		assert.throws(() => assertTargetArch('riscv', '--target-arch'), /want amd64\|arm64/)
	})

	it('resolveTargetArch precedence: CLI > env > config > host', () => {
		assert.equal(resolveTargetArch({ cli: 'arm64', env: 'amd64', config: 'amd64' }), 'arm64')
		assert.equal(resolveTargetArch({ cli: '', env: 'amd64', config: 'arm64' }), 'amd64')
		assert.equal(resolveTargetArch({ cli: '', env: '', config: 'arm64' }), 'arm64')
		assert.equal(resolveTargetArch({ cli: '', env: '', config: '' }), '')
		assert.equal(resolveTargetArch({}), '')
		assert.throws(() => resolveTargetArch({ cli: 'riscv' }), /invalid --target-arch/)
		assert.throws(() => resolveTargetArch({ cli: '', env: 'riscv' }), /invalid SWELTE_TARGET_ARCH/)
		assert.equal(resolveTargetArch({ cli: '', env: '', config: 'riscv' }), '')
	})

	it('vArchArgs shapes the v -o flag slice (host = no flag)', () => {
		assert.deepEqual(vArchArgs(''), [])
		assert.deepEqual(vArchArgs(undefined), [])
		assert.deepEqual(vArchArgs('amd64'), ['-arch', 'amd64'])
		assert.deepEqual(vArchArgs('arm64'), ['-arch', 'arm64'])
		assert.deepEqual(vArchArgs('x86_64'), ['-arch', 'amd64'])
	})

	it('zigTargetTriple maps pairs to zig -target vocabulary', () => {
		assert.equal(zigTargetTriple('linux', 'amd64'), 'x86_64-linux-gnu')
		assert.equal(zigTargetTriple('linux', 'arm64'), 'aarch64-linux-gnu')
		assert.equal(zigTargetTriple('macos', 'arm64'), 'aarch64-macos')
		assert.equal(zigTargetTriple('macos', 'amd64'), 'x86_64-macos')
		assert.equal(zigTargetTriple('windows', 'amd64'), 'x86_64-windows-gnu')
		assert.equal(zigTargetTriple('windows', 'arm64'), 'aarch64-windows-gnu')
	})

	it('resolveHostCC prefers system cc, falls back to the host zig wrapper', () => {
		const cc = resolveHostCC(import.meta.url)
		assert.ok(typeof cc === 'string' && cc.length > 0)
		// On this Linux dev machine gcc exists → absolute system path.
		assert.ok(cc === resolveCC() || cc.includes('zig-cc-'))
	})
})

describe('lazy sqlite amalgamation (db.sqlite builds only)', () => {
	it('detects the need from the copied backend hub module', () => {
		const gen = mkdtempSync(join(tmpdir(), 'gen-'))
		try {
			assert.equal(needsSqliteAmalgamation(gen), false)
			mkdirSync(join(gen, 'backend'), { recursive: true })
			writeFileSync(join(gen, 'backend', 'db.v'), 'module backend\n// no sqlite here\n')
			assert.equal(needsSqliteAmalgamation(gen), false)
			writeFileSync(join(gen, 'backend', 'db.v'), 'module backend\nimport db.sqlite\n')
			assert.equal(needsSqliteAmalgamation(gen), true)
		} finally {
			rmSync(gen, { recursive: true, force: true })
		}
	})

	it('hasSystemSqlite returns a boolean (env-dependent, never throws)', () => {
		assert.equal(typeof hasSystemSqlite(), 'boolean')
	})

	it('skips the fetch entirely when the build needs no sqlite', async () => {
		const gen = mkdtempSync(join(tmpdir(), 'gen-plain-'))
		try {
			const out = await ensureSqliteForBuild('/nonexistent/v', gen, () => {})
			assert.deepEqual(out, { needed: false, cached: true })
		} finally {
			rmSync(gen, { recursive: true, force: true })
		}
	})
})

describe('shared QJS link matrix (SSR and/or agent bridge)', () => {
	const mkGen = (): string => mkdtempSync(join(tmpdir(), 'gen-qjs-'))
	const realBridge = (flag: string) =>
		[
			'// Auto-generated',
			'module routes',
			'',
			'__global x bool',
			`#flag ${flag}@START_LIBS`,
			'',
		].join('\n')
	const stubBridge = ['module routes', '', 'pub fn swelte_qjs_render_page() {}', ''].join('\n')

	it('provider-only: no bridges → no link, native toolchain', () => {
		const gen = mkGen()
		try {
			assert.deepEqual(needsQjsLink(gen), [])
			assert.equal(hasRealBridge(gen), false)
			assert.equal(needsGlobals(gen), false)
			assert.deepEqual(bridgeLinkedArchives(gen), [])
			assert.equal(healDanglingBridge(gen), false)
		} finally {
			rmSync(gen, { recursive: true, force: true })
		}
	})

	it('SSR-only and agent-only each link; stub bridge never counts', () => {
		for (const shape of ['ssr', 'agent'] as const) {
			const gen = mkGen()
			try {
				const file =
					shape === 'ssr'
						? join(gen, 'routes', 'swelte_qjs_bridge.v')
						: join(gen, 'agent', 'agent_bridge.v')
				mkdirSync(join(gen, shape === 'ssr' ? 'routes' : 'agent'), { recursive: true })
				// Stub first: core's no-op must never trigger the QJS link.
				writeFileSync(file, stubBridge)
				assert.deepEqual(needsQjsLink(gen), [])
				assert.equal(hasRealBridge(gen), false)
				// Real bridge: this consumer links.
				writeFileSync(file, realBridge('/abs/libqjs.a'))
				assert.deepEqual(needsQjsLink(gen), [shape])
				assert.equal(hasRealBridge(gen), true)
				assert.equal(needsGlobals(gen), true)
				assert.deepEqual(bridgeLinkedArchives(gen), ['/abs/libqjs.a'])
			} finally {
				rmSync(gen, { recursive: true, force: true })
			}
		}
	})

	it('both bridges reference the SAME archive: linked once', () => {
		const gen = mkGen()
		try {
			mkdirSync(join(gen, 'routes'), { recursive: true })
			mkdirSync(join(gen, 'agent'), { recursive: true })
			writeFileSync(join(gen, 'routes', 'swelte_qjs_bridge.v'), realBridge('/abs/libqjs.a'))
			writeFileSync(join(gen, 'agent', 'agent_bridge.v'), realBridge('/abs/libqjs.a'))
			assert.deepEqual(needsQjsLink(gen), ['ssr', 'agent'])
			// One archive on the link line no matter how many bridges
			// consume it — never linked twice.
			assert.deepEqual(bridgeLinkedArchives(gen), ['/abs/libqjs.a'])
			assert.equal(hasRealBridge(gen), true)
		} finally {
			rmSync(gen, { recursive: true, force: true })
		}
	})

	it('dangling bridges heal independently; healthy bridges untouched', () => {
		const gen = mkGen()
		try {
			mkdirSync(join(gen, 'routes'), { recursive: true })
			mkdirSync(join(gen, 'agent'), { recursive: true })
			writeFileSync(join(gen, 'routes', 'swelte_qjs_bridge.v'), realBridge('/abs/missing.a'))
			writeFileSync(join(gen, 'agent', 'agent_bridge.v'), realBridge('/abs/missing.a'))
			assert.equal(healDanglingBridge(gen), true)
			assert.equal(existsSync(join(gen, 'routes', 'swelte_qjs_bridge.v')), false)
			assert.equal(existsSync(join(gen, 'agent', 'agent_bridge.v')), false)
			assert.deepEqual(needsQjsLink(gen), [])
			// Healing is idempotent: nothing dangling → false, stub kept.
			mkdirSync(join(gen, 'routes'), { recursive: true })
			writeFileSync(join(gen, 'routes', 'swelte_qjs_bridge.v'), stubBridge)
			assert.equal(healDanglingBridge(gen), false)
			assert.equal(existsSync(join(gen, 'routes', 'swelte_qjs_bridge.v')), true)
		} finally {
			rmSync(gen, { recursive: true, force: true })
		}
	})
})
