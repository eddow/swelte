import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from './types.js'
import { COMMANDS, commandHelp, findCommand, helpText } from './index.js'
import { main } from '../cli.js'

describe('CLI parsing', () => {
	it('unknown command -> exit 1 + help', async () => {
		const logs: string[] = []
		const errs: string[] = []
		const origLog = console.log
		const origErr = console.error
		console.log = (m?: unknown) => {
			logs.push(String(m))
		}
		console.error = (m?: unknown) => {
			errs.push(String(m))
		}
		process.exitCode = 0
		try {
			await main(['nope'])
		} finally {
			console.log = origLog
			console.error = origErr
		}
		assert.equal(process.exitCode, 1)
		assert.ok(errs.join('\n').includes('unknown command'))
		process.exitCode = 0
	})

	it('--port=abc -> number error', () => {
		const dev = findCommand('dev')
		assert.ok(dev)
		assert.throws(() => parseArgs(dev, ['--port=abc']), /needs a number/)
	})

	it('short flags parse', () => {
		const dev = findCommand('dev')
		assert.ok(dev)
		const { opts } = parseArgs(dev, ['-p', '1234'])
		assert.equal(opts.port, 1234)
	})

	it('check --format bogus throws at run', async () => {
		const check = findCommand('check')
		assert.ok(check)
		await assert.rejects(
			async () =>
				check.run({ argv: [], opts: { format: 'bogus' }, rest: [], log: () => {}, error: () => {} }),
			/--format must be text or json/
		)
	})

	it('helpText + commandHelp list all six commands', () => {
		const names = ['dev', 'build', 'preview', 'init', 'check', 'test']
		for (const n of names) {
			assert.ok(findCommand(n), n)
			assert.ok(helpText().includes(n))
			assert.ok(commandHelp(findCommand(n)!).includes(n))
		}
		assert.equal(COMMANDS.length, 6)
	})

	it('unknown option throws', () => {
		const dev = findCommand('dev')!
		assert.throws(() => parseArgs(dev, ['--nope']), /unknown option/)
	})
})
