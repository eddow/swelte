// `swelte` CLI entry. Dispatches to src/commands/*; bin/swelte.js is a
// ~5-line shim importing this module's main() (npm needs a runnable file
// before tsc runs — the shim is that file, nothing more).
import { COMMANDS, VERSION, commandHelp, findCommand, helpText } from './commands/index.js'
import type { Command } from './commands/types.js'
import { parseArgs } from './commands/types.js'

/** Resolve the active command list: core commands + plugin commands.
 * Plugins are optional — without them this is exactly COMMANDS. Pass the
 * loaded plugins to expose e.g. `swelte jobs` and friends. */
export function resolveCommands(
	plugins: { cli?: Command[] }[] = []
): Command[] {
	const extra = plugins.flatMap((p) => p.cli ?? [])
	if (!extra.length) return COMMANDS
	const names = new Set(COMMANDS.map((c) => c.name))
	for (const c of extra) {
		if (names.has(c.name)) throw new Error(`[swelte] plugin command '${c.name}' collides with a core command`)
		names.add(c.name)
	}
	return [...COMMANDS, ...extra]
}

/** Discover plugin packages exposing CLI commands.
 * Core knows no package by name: `SWELTE_PLUGINS` (comma/space-separated
 * specifiers) lists optional peers to probe. Each probed module contributes
 * every export shaped like a plugin (`{ cli, attrs }`). Unlisted /
 * uninstalled packages are skipped silently, keeping core dependency-free. */
export async function loadPluginPackages(
	specs: string[] = String(process.env.SWELTE_PLUGINS ?? '')
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean)
): Promise<{ cli?: Command[] }[]> {
	const out: { cli?: Command[] }[] = []
	for (const spec of specs) {
		try {
			const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>
			for (const v of Object.values(mod)) {
				if (typeof v === 'object' && v !== null && ('cli' in v || 'attrs' in v))
					out.push(v as { cli?: Command[] })
			}
		} catch {
			/* optional peer not installed — skip */
		}
	}
	return out
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const [name, ...rest] = argv
	const commands = resolveCommands(await loadPluginPackages())
	const find = (n: string): Command | undefined => commands.find((c) => c.name === n)
	const help = (): string => {
		const lines = ['Usage: swelte <command> [options]', '', 'Commands:']
		for (const c of commands) lines.push(`  ${c.name.padEnd(10)} ${c.summary}`)
		lines.push('', 'Run `swelte <command> --help` for command options.')
		return lines.join('\n')
	}
	if (!name || name === '--help' || name === '-h') {
		console.log(help())
		console.log(`\nswelte v${VERSION}`)
		return
	}
	if (name === '--version' || name === '-V') {
		console.log(VERSION)
		return
	}
	const cmd = find(name)
	if (!cmd) {
		console.error(`swelte: unknown command "${name}".`)
		console.error(help())
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
