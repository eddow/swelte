import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Command } from './types.js'
import { parseArgs, parseBoolFlag } from './types.js'

const cmd: Command = {
	name: 'x',
	summary: 'x',
	args: [{ name: 'sample', help: 's', value: 'boolean' }],
	run() {},
}

describe('parseBoolFlag', () => {
	it('bare flag is true', () => {
		assert.equal(parseArgs(cmd, ['--sample']).opts.sample, true)
	})
	it('false-like values are false', () => {
		for (const v of ['false', '0', 'no', 'off', 'n', 'FALSE', 'No']) {
			assert.equal(parseArgs(cmd, [`--sample=${v}`]).opts.sample, false, v)
			assert.equal(parseBoolFlag(v), false, v)
		}
	})
	it('other values are true', () => {
		for (const v of ['true', '1', 'yes', 'y']) {
			assert.equal(parseArgs(cmd, [`--sample=${v}`]).opts.sample, true, v)
		}
	})
})
