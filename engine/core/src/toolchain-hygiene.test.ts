import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizedPath, toolchainEnv } from './toolchain.js'

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
