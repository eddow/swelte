// `swelte init <dir>`: scaffold a new Swelte project.
// `templates/base/` is the empty skeleton; `templates/sample/src/` overlays
// the demo routes/lib on top (`--sample`, or interactive pick). Only
// `__NAME__` is replaced. Generated files (server harness, routers) are
// NEVER scaffolded — `dev`/`build` derive them into `.swelte/`.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as readline from 'node:readline'
import type { Ctx } from './types.js'

function templatesRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url))
	const candidates = [
		join(here, '..', '..', 'templates'),
		join(here, '..', 'templates'),
	]
	for (const c of candidates) {
		if (existsSync(join(c, 'base', 'svelte.config.js'))) return c
	}
	throw new Error('swelte templates/ not found (reinstall @swelte/core)')
}

async function askSample(): Promise<boolean> {
	// Piped stdin (echo y | ...) or non-TTY: can't prompt, default empty.
	if (!process.stdin.isTTY) {
		// Still drain a piped 'y' answer if present (scripted use).
		try {
			const chunks: Buffer[] = []
			for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
			const piped = Buffer.concat(chunks).toString().trim()
			if (/^[yY]/.test(piped)) return true
		} catch {
			/* fall through to empty */
		}
		return false
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	try {
		const answer = await new Promise<string>((resolveQ) => {
			rl.question('Include sample routes (demo api/admin/files/users)? [y/N] ', resolveQ)
		})
		return /^[yY]/.test(answer.trim())
	} finally {
		rl.close()
	}
}

export async function runInit(ctx: Ctx): Promise<void> {
	const target = ctx.rest[0] ?? String(ctx.opts.dir ?? 'my-swelte-app')
	const root = resolve(String(ctx.opts.root ?? process.cwd()), target)
	if (existsSync(root) && readdirSync(root).length > 0) {
		throw new Error(`target ${root} exists and is not empty (pass an empty dir)`)
	}
	const wantSample =
		ctx.opts.sample === true || ctx.opts.template === 'sample'
			? true
			: ctx.opts.empty === true || ctx.opts.template === 'empty'
				? false
				: await askSample()
	mkdirSync(root, { recursive: true })
	const name = target.split('/').filter(Boolean).pop() ?? 'my-swelte-app'
	const templates = templatesRoot()
	cpSync(join(templates, 'base'), root, { recursive: true })
	if (wantSample) cpSync(join(templates, 'sample', 'src'), join(root, 'src'), { recursive: true })
	// Only placeholder: project name.
	for (const rel of ['package.json', 'svelte.config.js', 'index.html', 'src/app.html', 'src/routes/+page.svelte', 'src/routes/+page.v']) {
		const abs = join(root, rel)
		if (!existsSync(abs)) continue
		writeFileSync(abs, readFileSync(abs, 'utf8').split('__NAME__').join(name))
	}
	ctx.log(`scaffolded ${wantSample ? 'sample' : 'empty'} project at ${root}`)
	ctx.log('next: npm install && swelte dev')
}
