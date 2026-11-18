// `create-@swelte` entry: `npm create @swelte [<dir>] [options]`.
// Self-contained argv parsing (no @swelte/core import — the scaffolder must
// stay install-light). Supports `--name value`, `--name=value`, `-s value`,
// `--flag`, and `--no-<flag>` negation for booleans.
import { type CreateOpts, runCreate, VERSION } from './scaffold.js'

interface ArgDef {
	name: keyof CreateOpts | 'help' | 'version'
	short?: string
	help: string
	value?: 'string' | 'boolean'
}

const ARGS: ArgDef[] = [
	{ name: 'root', help: 'Parent dir for the scaffold', value: 'string' },
	{ name: 'dir', help: 'Target directory name', value: 'string' },
	{ name: 'sample', help: 'Include sample routes (demo api/admin/files/users)', value: 'boolean' },
	{ name: 'empty', help: 'Empty skeleton only (no prompt)', value: 'boolean' },
	{ name: 'template', help: 'Template to use: empty | sample | lib', value: 'string' },
	{ name: 'kind', help: 'Project kind: app | lib (no prompt)', value: 'string' },
	{
		name: 'lib',
		help: 'Scaffold a library (src/lib published, src/routes dogfood; build + build:lib scripts)',
		value: 'boolean',
	},
	{
		name: 'no-interactive',
		help: 'Never prompt: use flag defaults (same as CI/non-TTY)',
		value: 'boolean',
	},
	{
		name: 'yes',
		short: 'y',
		help: 'Alias for --no-interactive (accept defaults)',
		value: 'boolean',
	},
	{
		name: 'ssr',
		help: 'Include SSR via @swelte/ssr-qjs (else SPA-only; --no-ssr forces SPA)',
		value: 'boolean',
	},
]

function parseBoolFlag(raw: string | undefined): boolean {
	if (raw === undefined) return true
	const v = raw.toLowerCase()
	return !(v === 'false' || v === '0' || v === 'no' || v === 'off' || v === 'n')
}

function helpText(): string {
	const lines = [
		'Usage: npm create @swelte [<dir>] [options]',
		'',
		'Scaffold a new Swelte project in <dir> (default my-swelte-app). App (routes served) or lib (src/lib published, src/routes dogfood); empty skeleton unless --sample; SPA-only unless --ssr.',
		'',
		'Options:',
	]
	for (const a of [
		...ARGS,
		{ name: 'help', short: 'h', help: 'Show this help', value: 'boolean' } as ArgDef,
	]) {
		const flag = a.short ? `--${a.name as string}, -${a.short}` : `--${String(a.name)}`
		lines.push(
			`  ${flag.padEnd(22)} ${a.help}${a.value && a.value !== 'boolean' ? ` <${a.value}>` : ''}`
		)
	}
	return lines.join('\n')
}

function parseArgs(argv: string[]): { opts: CreateOpts; rest: string[] } {
	const defs = new Map<string, ArgDef>()
	for (const a of ARGS) {
		defs.set(a.name as string, a)
		if (a.short) defs.set(`-${a.short}`, a)
	}
	const opts: CreateOpts = {}
	const rest: string[] = []
	let i = 0
	while (i < argv.length) {
		const tok = argv[i]
		if (tok.startsWith('--')) {
			const eq = tok.indexOf('=')
			const key = eq >= 0 ? tok.slice(2, eq) : tok.slice(2)
			const rawVal = eq >= 0 ? tok.slice(eq + 1) : undefined
			const def = defs.get(key) ?? (key.startsWith('no-') ? defs.get(key.slice(3)) : undefined)
			if (!def) throw new Error(`unknown option --${key}`)
			if (def.value === 'boolean' || !def.value) {
				opts[def.name] =
					key.startsWith('no-') && rawVal === undefined ? false : parseBoolFlag(rawVal)
			} else {
				const raw = eq >= 0 ? tok.slice(eq + 1) : argv[++i]
				if (raw === undefined) throw new Error(`--${key} needs a value`)
				opts[def.name] = raw as never
			}
			i++
		} else if (tok.startsWith('-') && tok.length === 2) {
			const def = defs.get(tok)
			if (!def) throw new Error(`unknown option ${tok}`)
			if (def.value === 'boolean' || !def.value) {
				opts[def.name] = true as never
			} else {
				const raw = argv[++i]
				if (raw === undefined) throw new Error(`${tok} needs a value`)
				opts[def.name] = raw as never
			}
			i++
		} else {
			rest.push(tok)
			i++
		}
	}
	return { opts, rest }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(helpText())
		return
	}
	if (argv.includes('--version') || argv.includes('-V')) {
		console.log(VERSION)
		return
	}
	let parsed
	try {
		parsed = parseArgs(argv)
	} catch (e) {
		console.error(`create-@swelte: ${(e as Error).message}`)
		console.error(helpText())
		process.exitCode = 1
		return
	}
	try {
		await runCreate(parsed.opts, parsed.rest)
	} catch (e) {
		console.error(`create-@swelte: ${(e as Error).message}`)
		process.exitCode = 1
	}
}
