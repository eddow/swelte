// `swelte` CLI entry. Dispatches to src/commands/*; bin/swelte.js is a
// ~5-line shim importing this module's main() (npm needs a runnable file
// before tsc runs — the shim is that file, nothing more).
import { COMMANDS, VERSION, commandHelp, findCommand, helpText } from './commands/index.js'
import { parseArgs } from './commands/types.js'

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const [name, ...rest] = argv
	if (!name || name === '--help' || name === '-h') {
		console.log(helpText())
		console.log(`\nswelte v${VERSION}`)
		return
	}
	if (name === '--version' || name === '-V') {
		console.log(VERSION)
		return
	}
	const cmd = findCommand(name)
	if (!cmd) {
		console.error(`swelte: unknown command "${name}".`)
		console.error(helpText())
		process.exitCode = 1
		return
	}
	let parsed
	try {
		parsed = parseArgs(cmd, rest)
	} catch (e) {
		console.error(`swelte ${name}: ${(e as Error).message}`)
		console.error(commandHelp(cmd))
		process.exitCode = 1
		return
	}
	if (parsed.opts.help) {
		console.log(commandHelp(cmd))
		return
	}
	const ctx = {
		argv: rest,
		opts: parsed.opts,
		rest: parsed.rest,
		log: (msg: string) => console.log(`swelte ${name}: ${msg}`),
		error: (msg: string) => console.error(`swelte ${name}: ${msg}`),
	}
	try {
		await cmd.run(ctx)
	} catch (e) {
		ctx.error((e as Error).message)
		process.exitCode = 1
	}
}
