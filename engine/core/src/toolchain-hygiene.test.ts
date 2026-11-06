import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	assertTargetArch,
	assertTargetOs,
	hostTargetArch,
	hostTargetOs,
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
