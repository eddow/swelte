import type { ArgDef, Command, Ctx } from './types.js'
import { runDev } from './dev.js'
import { runBuild } from './build.js'
import { runPreview } from './preview.js'
import { runInit } from './init.js'
import { runTest } from './test.js'

export const VERSION = '0.1.0'

const devCmd: Command = {
	name: 'dev',
	summary: 'Run V backend + Vite with HMR proxy (one command, kills both on Ctrl-C).',
	args: [
		{ name: 'port', short: 'p', help: 'Vite port', value: 'number' },
		{ name: 'backend', short: 'b', help: 'V backend port', value: 'number' },
		{ name: 'root', help: 'Project root', value: 'string' },
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
	summary:
		'Scaffold a new Swelte project in <dir> (default my-swelte-app). Empty skeleton unless --sample.',
	args: [
		{ name: 'root', help: 'Parent dir for the scaffold', value: 'string' },
		{ name: 'dir', help: 'Target directory name', value: 'string' },
		{
			name: 'sample',
			help: 'Include sample routes (demo api/admin/files/users)',
			value: 'boolean',
		},
		{ name: 'empty', help: 'Empty skeleton only (no prompt)', value: 'boolean' },
		{ name: 'template', help: 'Template to use: empty | sample', value: 'string' },
	],
	async run(ctx: Ctx) {
		await runInit(ctx)
	},
}

const checkCmd: Command = {
	name: 'check',
	summary: 'Validate .v files: warnings as text or --format json (roadmap item 15).',
	args: [
		{ name: 'root', help: 'Project root', value: 'string' },
		{ name: 'format', help: 'Output format: text | json', value: 'string' },
	],
	async run(ctx: Ctx) {
		const { resolve } = await import('node:path')
		const root = resolve(String(ctx.opts.root ?? process.cwd()))
		const { collectDiagnostics } = await import('../gen/diagnostics.js')
		const diags = await collectDiagnostics(root)
		const fmt = String(ctx.opts.format ?? 'text')
		if (fmt !== 'text' && fmt !== 'json')
			throw new Error('--format must be text or json (got ' + fmt + ')')
		if (fmt === 'json') {
			console.log(JSON.stringify(diags, null, 2))
		} else if (diags.length === 0) {
			ctx.log('check: no warnings')
		} else {
			for (const d of diags) ctx.log(d.file + ':' + d.line + ' [' + d.kind + '] ' + d.message)
		}
	},
}

const testCmd: Command = {
	name: 'test',
	summary: 'V tests (v test) + TS contract check (stubs match projected types).',
	args: [{ name: 'root', help: 'Project root', value: 'string' }],
	async run(ctx: Ctx) {
		await runTest(ctx)
	},
}

export const COMMANDS: Command[] = [devCmd, buildCmd, previewCmd, initCmd, checkCmd, testCmd]

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
