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
				check.run({
					argv: [],
					opts: { format: 'bogus' },
					rest: [],
					log: () => {},
					error: () => {},
				}),
			/--format must be text or json/
		)
	})

	it('helpText + commandHelp list all commands', () => {
		const names = ['dev', 'build', 'preview', 'init', 'check', 'test', 'export']
		for (const n of names) {
			assert.ok(findCommand(n), n)
			assert.ok(helpText().includes(n))
			assert.ok(commandHelp(findCommand(n)!).includes(n))
		}
		assert.equal(COMMANDS.length, 7)
	})

	it('unknown option throws', () => {
		const dev = findCommand('dev')!
		assert.throws(() => parseArgs(dev, ['--nope']), /unknown option/)
	})

	it('build --target-os parses (cross-build is build-only)', () => {
		const build = findCommand('build')!
		const { opts } = parseArgs(build, ['--target-os', 'macos'])
		assert.equal(opts['target-os'], 'macos')
		const { opts: eq } = parseArgs(build, ['--target-os=windows'])
		assert.equal(eq['target-os'], 'windows')
		// no short flag: -t stays the deploy-target shim
		const { opts: t } = parseArgs(build, ['-t', 'node'])
		assert.equal(t.target, 'node')
		assert.equal(t['target-os'], undefined)
		// dev/preview/test reject it (build-only)
		for (const n of ['dev', 'preview', 'test']) {
			assert.throws(() => parseArgs(findCommand(n)!, ['--target-os', 'linux']), /unknown option/)
		}
	})
})
