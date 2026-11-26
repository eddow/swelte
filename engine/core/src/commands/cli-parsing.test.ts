import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { main } from '../cli.js'
import { COMMANDS, commandHelp, findCommand, helpText } from './index.js'
import { parseArgs } from './types.js'

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
		const names = [
			'dev',
			'build',
			'preview',
			'deploy',
			'package',
			'check',
			'test',
			'export',
			// `migrate` is Plus-owned (§3 box 2): not a core command, it
			// resolves via the configured `plugins: [dbPlugin]` entry.
		]
		for (const n of names) {
			assert.ok(findCommand(n), n)
			assert.ok(helpText().includes(n))
			assert.ok(commandHelp(findCommand(n)!).includes(n))
		}
		assert.equal(findCommand('init'), undefined, 'init removed: use npm create @swelte')
		assert.equal(findCommand('migrate'), undefined, 'migrate is Plus-owned, not core')
		assert.equal(COMMANDS.length, 8)
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

	it('build --target-arch parses (build-only, same contract as --target-os)', () => {
		const build = findCommand('build')!
		const { opts } = parseArgs(build, ['--target-arch', 'arm64'])
		assert.equal(opts['target-arch'], 'arm64')
		const { opts: eq } = parseArgs(build, ['--target-arch=amd64'])
		assert.equal(eq['target-arch'], 'amd64')
		// no short flag: -t stays the deploy-target shim
		const { opts: t } = parseArgs(build, ['-t', 'node'])
		assert.equal(t.target, 'node')
		assert.equal(t['target-arch'], undefined)
		// dev/preview/test reject it (build-only)
		for (const n of ['dev', 'preview', 'test']) {
			assert.throws(() => parseArgs(findCommand(n)!, ['--target-arch', 'arm64']), /unknown option/)
		}
	})

	it('build --local parses (boolean, build-only)', () => {
		const build = findCommand('build')!
		const { opts } = parseArgs(build, ['--local'])
		assert.equal(opts.local, true)
		const { opts: eq } = parseArgs(build, ['--local=false'])
		assert.equal(eq.local, false)
		// dev/preview/test reject it (build-only)
		for (const n of ['dev', 'preview', 'test']) {
			assert.throws(() => parseArgs(findCommand(n)!, ['--local']), /unknown option/)
		}
	})

	it('--cc parses: bare forces, path pins (build + dev)', () => {
		for (const n of ['build', 'dev']) {
			const cmd = findCommand(n)!
			assert.equal(parseArgs(cmd, ['--cc']).opts.cc, true)
			assert.equal(parseArgs(cmd, ['--cc', '/opt/gcc']).opts.cc, '/opt/gcc')
			assert.equal(parseArgs(cmd, ['--cc=/opt/gcc']).opts.cc, '/opt/gcc')
			// Followed by another flag, the bare form still forces.
			assert.equal(parseArgs(cmd, ['--cc', '--root', 'x']).opts.cc, true)
			// Explicit false still parses (negation clears the knob).
			assert.equal(parseArgs(cmd, ['--cc=false']).opts.cc, 'false')
		}
		// preview/test reject it (backend-compile commands only)
		for (const n of ['preview', 'test']) {
			assert.throws(() => parseArgs(findCommand(n)!, ['--cc']), /unknown option/)
		}
	})
})
