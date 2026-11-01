// Minimal argv parsing for `swelte <command> [options]`.
// Supports `--name value`, `--name=value`, `-s value`, `--flag` (boolean).
export interface ArgDef {
	name: string
	short?: string
	help: string
	value?: 'string' | 'number' | 'boolean'
}

export interface Command {
	name: string
	summary: string
	args?: ArgDef[]
	run: (ctx: Ctx) => Promise<void> | void
}

export interface Ctx {
	argv: string[]
	opts: Record<string, string | number | boolean>
	rest: string[]
	log: (msg: string) => void
	error: (msg: string) => void
}

export function parseBoolFlag(raw: string | undefined): boolean {
	if (raw === undefined) return true
	const v = raw.toLowerCase()
	return !(v === 'false' || v === '0' || v === 'no' || v === 'off' || v === 'n')
}

export function parseArgs(cmd: Command, argv: string[]): { opts: Ctx['opts']; rest: string[] } {
	const defs = new Map<string, ArgDef>()
	for (const a of [
		...(cmd.args ?? []),
		{ name: 'help', short: 'h', help: 'Show help', value: 'boolean' as const },
	]) {
		defs.set(a.name, a)
		if (a.short) defs.set(`-${a.short}`, a)
	}
	const opts: Ctx['opts'] = {}
	const rest: string[] = []
	let i = 0
	while (i < argv.length) {
		const tok = argv[i]
		if (tok.startsWith('--')) {
			const eq = tok.indexOf('=')
			const key = eq >= 0 ? tok.slice(2, eq) : tok.slice(2)
			const def = defs.get(key)
			if (!def) throw new Error(`unknown option --${key}`)
			if (def.value === 'boolean' || !def.value) {
				opts[def.name] = parseBoolFlag(eq >= 0 ? tok.slice(eq + 1) : undefined)
				i++
			} else {
				const raw = eq >= 0 ? tok.slice(eq + 1) : argv[++i]
				if (raw === undefined) throw new Error(`--${key} needs a value`)
				opts[def.name] = def.value === 'number' ? Number(raw) : raw
				if (def.value === 'number' && Number.isNaN(opts[def.name]))
					throw new Error(`--${key} needs a number`)
				i++
			}
		} else if (tok.startsWith('-') && tok.length === 2) {
			const def = defs.get(tok)
			if (!def) throw new Error(`unknown option ${tok}`)
			if (def.value === 'boolean' || !def.value) {
				opts[def.name] = true
				i++
			} else {
				const raw = argv[++i]
				if (raw === undefined) throw new Error(`${tok} needs a value`)
				opts[def.name] = def.value === 'number' ? Number(raw) : raw
				i++
			}
		} else {
			rest.push(tok)
			i++
		}
	}
	return { opts, rest }
}
