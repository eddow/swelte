// `swelte init <dir>`: scaffold a new Swelte project.
// `templates/base/` is the empty skeleton (SPA-only: `@swelte/core/vite`);
// `templates/sample/src/` overlays the demo routes/lib on top (`--sample`,
// or interactive pick). `--ssr` (interactive opt-in, default No) adds the
// `@swelte/ssr-qjs` engine (SSR via embedded QuickJS; SPA otherwise).
// Only `__NAME__` (+ `__SWELTE_VERSION__` in package.json) is replaced.
// Generated files (server harness, client entry, routers) are NEVER
// scaffolded — `dev`/`build` derive them into `.swelte/`.
// src/app.ts is the optional user-owned setup hook; the engine-owned
// .swelte/entry-main.ts imports it (plus src/app.css when present), and the
// plugin's transformIndexHtml points the script tag at .swelte/entry-main.ts.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as readline from 'node:readline'
import { VERSION } from '../version.js'
import type { Ctx } from './types.js'

function templatesRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url))
	const candidates = [join(here, '..', '..', 'templates'), join(here, '..', 'templates')]
	for (const c of candidates) {
		if (existsSync(join(c, 'base', 'svelte.config.js'))) return c
	}
	throw new Error('swelte templates/ not found (reinstall @swelte/core)')
}

async function ask(question: string, pipedYes: (line: string) => boolean): Promise<boolean> {
	// Piped stdin (echo y | ...) or non-TTY: can't prompt, default no.
	if (!process.stdin.isTTY) {
		// Still drain a piped 'y' answer if present (scripted use).
		// Stdin may already be consumed (two prompts): treat as no.
		try {
			if (process.stdin.readableEnded) return false
			const chunks: Buffer[] = []
			for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
			const piped = Buffer.concat(chunks).toString().trim()
			if (/^[yY]/.test(piped)) return pipedYes(piped)
		} catch {
			/* fall through to no */
		}
		return false
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	try {
		const answer = await new Promise<string>((resolveQ) => {
			rl.question(question, resolveQ)
		})
		return /^[yY]/.test(answer.trim())
	} finally {
		rl.close()
	}
}

async function askSample(): Promise<boolean> {
	return ask('Include sample routes (demo api/admin/files/users)? [y/N] ', (piped) => piped.length <= 1)
}

async function askSsr(): Promise<boolean> {
	// Opt-in, default No: SSR engine is `npm install @swelte/ssr-qjs` + swap
	// the `swelte` import in vite.config.ts — tell the user, then ask.
	return ask(
		'Enable SSR via @swelte/ssr-qjs (else SPA-only; install later with `npm install @swelte/ssr-qjs`)? [y/N] ',
		() => false,
	)
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
	// SSR is opt-in (default No): --ssr adds the engine; interactively asked.
	// Piped stdin can't answer twice (sample drains it), so only --ssr opts
	// in non-TTY; plain `echo y |` keeps SPA (same as before).
	const wantSsr = ctx.opts.ssr === true ? true : process.stdin.isTTY ? await askSsr() : false
	mkdirSync(root, { recursive: true })
	const name = target.split('/').filter(Boolean).pop() ?? 'my-swelte-app'
	const templates = templatesRoot()
	cpSync(join(templates, 'base'), root, { recursive: true })
	if (wantSample) cpSync(join(templates, 'sample', 'src'), join(root, 'src'), { recursive: true })
	// Only placeholders: project name (+ engine version pin in package.json).
	// SSR: swap the `swelte` import to the QJS adapter + add the dep.
	for (const rel of [
		'package.json',
		'vite.config.ts',
		'svelte.config.js',
		'index.html',
		'src/routes/+page.svelte',
		'src/routes/+page.v',
	]) {
		const abs = join(root, rel)
		if (!existsSync(abs)) continue
		let text = readFileSync(abs, 'utf8').split('__NAME__').join(name)
		if (wantSsr) {
			text = text
				.split(`"@swelte/core": "^__SWELTE_VERSION__"`)
				.join(`"@swelte/core": "^${VERSION}",\n    "@swelte/ssr-qjs": "^${VERSION}"`)
				.split(`import { swelte } from '@swelte/core/vite'`)
				.join(`import { swelte } from '@swelte/ssr-qjs'`)
				.split('__SWELTE_VERSION__')
				.join(VERSION)
		} else {
			text = text.split('__SWELTE_VERSION__').join(VERSION)
		}
		writeFileSync(abs, text)
	}
	ctx.log(`scaffolded ${wantSample ? 'sample' : 'empty'}${wantSsr ? ' +ssr' : ''} project at ${root}`)
	ctx.log('next: npm install && swelte dev')
}
