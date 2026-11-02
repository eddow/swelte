import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
	assertTargetOs,
	hostTargetOs,
	normalizeTargetOs,
	resolveTargetOs,
	sanitizedPath,
	toolchainEnv,
	vOsArgs,
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
})
