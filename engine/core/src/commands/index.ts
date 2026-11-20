import { migrateCommand } from '../backend/jobs-index.js'
import { VERSION } from '../version.js'
import { runBuild } from './build.js'
import { runDeploy } from './deploy.js'
import { runDev } from './dev.js'
import { runExport } from './export.js'
import { runPreview } from './preview.js'
import { runTest } from './test.js'
import type { ArgDef, Command, Ctx } from './types.js'

export { VERSION }

const devCmd: Command = {
	name: 'dev',
	summary: 'Run V backend + Vite with HMR proxy (one command, kills both on Ctrl-C).',
	args: [
		{ name: 'port', short: 'p', help: 'Vite port', value: 'number' },
		{ name: 'backend', short: 'b', help: 'V backend port', value: 'number' },
		{ name: 'root', help: 'Project root', value: 'string' },
		{
			name: 'ssr-port',
			help: 'SSR sidecar port (only when @swelte/ssr-qjs is installed)',
			value: 'number',
		},
		{
			name: 'ssr',
			help: 'Enable SSR sidecar when @swelte/ssr-qjs is installed (default: auto; --no-ssr forces SPA)',
			value: 'boolean',
		},
	],
	async run(ctx: Ctx) {
		await runDev(ctx)
	},
}

const buildCmd: Command = {
	name: 'build',
	summary: 'Typecheck -> generate -> v -o dist/server -> vite build (+ smoke probe).',
	args: [
		{ name: 'root', help: 'Project root', value: 'string' },
		{ name: 'output', short: 'o', help: 'Server binary output path', value: 'string' },
		{ name: 'port', short: 'p', help: 'Smoke-probe port', value: 'number' },
		{
			name: 'target',
			short: 't',
			help: 'Deploy target shim: auto | static | node | edge',
			value: 'string',
		},
		{
			name: 'target-os',
			help: 'Cross-build OS: linux | macos | windows (also SWELTE_TARGET_OS, swelte.targetOs)',
			value: 'string',
		},
		{
			name: 'target-arch',
			help: 'Cross-build arch: amd64 | arm64 (also SWELTE_TARGET_ARCH, swelte.targetArch)',
			value: 'string',
		},
		{
			name: 'local',
			help: 'Force host-native build, ignoring the package.json swelte.targetOs/targetArch declaration',
			value: 'boolean',
		},
	],
	async run(ctx: Ctx) {
		await runBuild(ctx)
	},
}

const previewCmd: Command = {
	name: 'preview',
	summary: 'Run the built V binary only: dist/ + API on one port, no Vite.',
	args: [
		{ name: 'port', short: 'p', help: 'Port to serve on', value: 'number' },
		{ name: 'root', help: 'Project root', value: 'string' },
		{ name: 'binary', help: 'Server binary path', value: 'string' },
	],
	async run(ctx: Ctx) {
		await runPreview(ctx)
	},
}

const initCmd: Command = {
	name: 'init',
	summary: 'DEPRECATED: use `npm create @swelte` (@swelte/create). Forwards to it when installed.',
	args: [
		{ name: 'root', help: 'Parent dir for the scaffold', value: 'string' },
		{ name: 'dir', help: 'Target directory name', value: 'string' },
		{
			name: 'sample',
			help: 'Include sample routes (demo api/admin/files/users)',
			value: 'boolean',
		},
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
	],
	async run(ctx: Ctx) {
		ctx.error('`swelte init` moved to `npm create @swelte` (@swelte/create) — forwarding.')
		try {
			const mod = (await import(/* @vite-ignore */ '@swelte/create/scaffold')) as Record<
				string,
				unknown
			>
			const runCreate = mod.runCreate as (
				opts: Record<string, unknown>,
				rest: string[],
				log: (m: string) => void
			) => Promise<void>
			if (typeof runCreate !== 'function') throw new Error('no runCreate export')
			await runCreate({ ...ctx.opts }, ctx.rest, (m) => ctx.log(m))
		} catch {
			throw new Error(
				'install the scaffolder (`npm install -g @swelte/create`) or run `npm create @swelte`'
			)
		}
	},
}

const deployCmd: Command = {
	name: 'deploy',
	summary:
		'Generate deploy wrapper files (Dockerfile + ignores + package.json target) — setup only, never ships.',
	args: [
		{
			name: 'target',
			help: 'Deploy target: vercel | docker | fly | railway | render | static',
			value: 'string',
		},
		{
			name: 'dockerfile',
			help: 'Dockerfile name (default Dockerfile.vercel for vercel, Dockerfile otherwise)',
			value: 'string',
		},
		{
			name: 'force',
			help: 'Overwrite package.json swelte.targetOs/targetArch when already set',
			value: 'boolean',
		},
		{ name: 'dry-run', help: 'Preview writes without touching disk', value: 'boolean' },
		{
			name: 'check',
			help: 'Verify-only: drift check without writes (like swelte check)',
			value: 'boolean',
		},
		{ name: 'format', help: 'Output format: text | json (status)', value: 'string' },
		{ name: 'root', help: 'Project root', value: 'string' },
	],
	async run(ctx: Ctx) {
		await runDeploy(ctx)
	},
}

const checkCmd: Command = {
	name: 'check',
	summary: 'Validate .v files: warnings as text or --format json (roadmap item 15).',
	args: [
		{ name: 'root', help: 'Project root', value: 'string' },
		{ name: 'format', help: 'Output format: text | json', value: 'string' },
		{
			name: 'lib',
			help: 'Also validate the library schema (src/lib published, src/routes dogfood)',
			value: 'boolean',
		},
	],
	async run(ctx: Ctx) {
		const { resolve } = await import('node:path')
		const root = resolve(String(ctx.opts.root ?? process.cwd()))
		const { collectDiagnostics } = await import('../gen/diagnostics.js')
		const diags = await collectDiagnostics(root, { lib: Boolean(ctx.opts.lib) })
		const fmt = String(ctx.opts.format ?? 'text')
		if (fmt !== 'text' && fmt !== 'json')
			throw new Error(`--format must be text or json (got ${fmt})`)
		if (fmt === 'json') {
			console.log(JSON.stringify(diags, null, 2))
		} else if (diags.length === 0) {
			ctx.log('check: no warnings')
		} else {
			for (const d of diags) ctx.log(`${d.file}:${d.line} [${d.kind}] ${d.message}`)
		}
	},
}

const testCmd: Command = {
	name: 'test',
	summary: 'V tests (v test) + TS contract check (stubs match projected types).',
	args: [
		{ name: 'root', help: 'Project root', value: 'string' },
		{ name: 'update-snapshot', short: 'u', help: 'Rewrite swelte.contract.json', value: 'boolean' },
	],
	async run(ctx: Ctx) {
		await runTest(ctx)
	},
}

const exportCmd: Command = {
	name: 'export',
	summary: 'Snapshot the crawl: entries.json + rendered dist/*.html + contract -> snapshot/.',
	args: [
		{ name: 'root', help: 'Project root', value: 'string' },
		{ name: 'out', short: 'o', help: 'Snapshot output dir', value: 'string' },
	],
	async run(ctx: Ctx) {
		await runExport(ctx)
	},
}

export const COMMANDS: Command[] = [
	devCmd,
	buildCmd,
	previewCmd,
	deployCmd,
	initCmd,
	checkCmd,
	testCmd,
	exportCmd,
	migrateCommand as Command,
]

export function findCommand(name: string): Command | undefined {
	return COMMANDS.find((c) => c.name === name)
}

export function helpText(): string {
	const lines = ['Usage: swelte <command> [options]', '', 'Commands:']
	for (const c of COMMANDS) lines.push(`  ${c.name.padEnd(10)} ${c.summary}`)
	lines.push('', 'Run `swelte <command> --help` for command options.')
	return lines.join('\n')
}

export function commandHelp(cmd: Command): string {
	const lines = [`Usage: swelte ${cmd.name} [options]`, '', cmd.summary, '', 'Options:']
	const args: ArgDef[] = [
		...(cmd.args ?? []),
		{ name: 'help', short: 'h', help: 'Show this help', value: 'boolean' },
	]
	for (const a of args) {
		const flag = a.short ? `--${a.name}, -${a.short}` : `--${a.name}`
		lines.push(
			`  ${flag.padEnd(22)} ${a.help}${a.value && a.value !== 'boolean' ? ` <${a.value}>` : ''}`
		)
	}
	return lines.join('\n')
}
