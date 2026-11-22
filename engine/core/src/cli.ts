// `swelte` CLI entry. Dispatches to src/commands/*; bin/swelte.js is a
// ~5-line shim importing this module's main() (npm needs a runnable file
// before tsc runs — the shim is that file, nothing more).

import { resolve } from 'node:path'
import { COMMANDS, commandHelp, VERSION } from './commands/index.js'
import type { Command } from './commands/types.js'
import { parseArgs } from './commands/types.js'
import { assertPluginCli, assertPluginName, dedupPlugins } from './vite/plugins.js'
import type { SweltePlugin } from './vite/types.js'

/** Resolve the active command list: core COMMANDS + configured plugin
 *  commands (deduped by plugin `name`, first wins — same rule as generate()).
 *  Init order = registration order; failure = colliding command names throw
 *  (first registration wins per name, core names are reserved).
 *  Every entry must be a named `SweltePlugin` — bare `{ cli }` providers are
 *  rejected loudly instead of silently registering nothing. */
export function resolveCommands(plugins: { cli?: Command[]; name?: string }[] = []): Command[] {
	for (const entry of plugins) {
		if (!entry || typeof entry !== 'object')
			throw new Error('[swelte] plugin command provider must be an object')
		const name = assertPluginName((entry as { name?: unknown }).name)
		assertPluginCli(name, (entry as { cli?: unknown }).cli ?? [])
	}
	const ordered = dedupPlugins(plugins as SweltePlugin[])
	const extra = ordered.flatMap((p) => p.cli ?? [])
	if (!extra.length) return COMMANDS
	const names = new Set(COMMANDS.map((c) => c.name))
	for (const c of extra) {
		if (names.has(c.name))
			throw new Error(`[swelte] plugin command '${c.name}' collides with an existing command`)
		names.add(c.name)
	}
	return [...COMMANDS, ...extra.filter((c) => !COMMANDS.some((k) => k.name === c.name))]
}

/** Discover plugin packages exposing CLI commands (e.g. `@swelte/plus`
 *  `migrate` when the app registers it via `swelte({ plugins: [dbPlugin] })`
 *  — `main()` merges configured plugins first, `SWELTE_PLUGINS` second).
 * Core knows no package by name: `SWELTE_PLUGINS` (comma/space-separated
 * specifiers) lists optional peers to probe. Each probed module contributes
 * every export shaped like a plugin (`{ cli, attrs }` — `name` required;
 * nameless `{ cli }` providers throw at resolveCommands). Unlisted /
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

export function commandRoot(ctx: { opts: Record<string, string | number | boolean> }): string {
	return resolve(String(ctx.opts.root ?? process.cwd()))
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const [name, ...rest] = argv
	// §1: configured plugins resolve identically for CLI and generate —
	// project config first, then SWELTE_PLUGINS env peers (dedup by name).
	// Root comes from --root (commands run against an explicit root).
	let configured: SweltePlugin[] = []
	try {
		// `--root <dir>` / `--root=<dir>` probe (no Command needed).
		let root = process.cwd()
		for (let i = 0; i < argv.length; i++) {
			if (argv[i] === '--root' && argv[i + 1]) {
				root = argv[i + 1]
				break
			}
			const m = /^--root=(.+)$/.exec(argv[i])
			if (m) {
				root = m[1]
				break
			}
		}
		const { loadProjectSweltePlugins } = await import('./gen/config.js')
		configured = await loadProjectSweltePlugins(resolve(root))
	} catch {
		/* config unreadable — CLI falls back to env discovery only */
	}
	const commands = resolveCommands([
		...configured,
		...((await loadPluginPackages()) as unknown as SweltePlugin[]),
	])
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
