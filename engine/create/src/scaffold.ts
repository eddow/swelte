// `npm create @swelte <dir>`: one project shape, two build targets.
// Base + optional sample templates; legacy lib flags select a reusable-V demo.
// Interactive wizard: directory → sample → SSR. Build runs the application;
// package builds src/lib, regardless of the selected starter.
// Generated files (server harness, client entry, routers) are NEVER
// scaffolded — `dev`/`build` derive them into `.swelte/`.
// src/app.ts is the optional user-owned setup hook; the engine-owned
// .swelte/entry-main.ts imports it (plus src/app.css when present), and the
// plugin's transformIndexHtml points the script tag at .swelte/entry-main.ts.

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { intro, isInteractive, outro, promptDirName, promptSample, promptSsr } from './prompts.js'

const require = createRequire(import.meta.url)
const manifest = require('../package.json')
export const VERSION: string = manifest.version
export const TEMPLATE_LINE = VERSION.split('.').slice(0, 2).join('.')
export const TEMPLATE_DEPS: Record<string, string> = manifest.templateMinimums

export interface CreateOpts {
	root?: string
	dir?: string
	sample?: boolean
	empty?: boolean
	template?: string
	kind?: string
	lib?: boolean
	ssr?: boolean
	yes?: boolean
	'no-interactive'?: boolean
	[key: string]: string | number | boolean | undefined
}

function templatesRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url))
	const candidates = [join(here, '..', 'templates'), join(here, '..', '..', 'templates')]
	for (const c of candidates) {
		if (existsSync(join(c, 'base', 'svelte.config.js'))) return c
	}
	throw new Error('create-@swelte templates/ not found (reinstall @swelte/create)')
}

export async function runCreate(
	opts: CreateOpts,
	rest: string[],
	log: (msg: string) => void = (m) => console.log(`create-@swelte: ${m}`)
): Promise<void> {
	const interactive = isInteractive(opts)
	let target = rest[0] ?? String(opts.dir ?? '')
	if (!target && interactive) {
		intro('create-@swelte')
		target = await promptDirName('my-swelte-app')
	} else {
		target ||= 'my-swelte-app'
		if (interactive) intro('create-@swelte')
	}
	const root = resolve(String(opts.root ?? process.cwd()), target)
	if (existsSync(root) && readdirSync(root).length > 0) {
		throw new Error(`target ${root} exists and is not empty (pass an empty dir)`)
	}
	// Compatibility flags select sample content, never a package kind.
	const wantLibSample = opts.lib === true || opts.kind === 'lib' || opts.template === 'lib'
	const wantSample = wantLibSample
		? false
		: opts.sample === true || opts.template === 'sample'
			? true
			: opts.empty === true || opts.template === 'empty'
				? false
				: interactive
					? await promptSample()
					: false
	// SSR is opt-in (default No): --ssr adds the engine, --no-ssr forces
	// SPA; otherwise ask interactively, default SPA in scripts/CI.
	const wantSsr =
		opts.ssr === true ? true : opts.ssr === false ? false : interactive ? await promptSsr() : false
	mkdirSync(root, { recursive: true })
	const name = target.split('/').filter(Boolean).pop() ?? 'my-swelte-app'
	const templates = templatesRoot()
	cpSync(join(templates, 'base'), root, { recursive: true })
	// npm strips dotfiles (templates/base/.gitignore) from the packed
	// tarball, so the repo stores it as `gitignore` and we rename on copy.
	// Every scaffolded project must ignore its build outputs from day one.
	// (The blanket cpSync above copied `gitignore` verbatim — remove that
	// stray so the project holds exactly one ignore file, `.gitignore`.)
	const gitignoreTpl = join(templates, 'base', 'gitignore')
	rmSync(join(root, 'gitignore'), { force: true })
	if (!existsSync(join(root, '.gitignore')) && existsSync(gitignoreTpl))
		cpSync(gitignoreTpl, join(root, '.gitignore'))
	if (wantSample) cpSync(join(templates, 'sample', 'src'), join(root, 'src'), { recursive: true })
	if (wantLibSample) {
		// Library overlay: public src/lib sample + src/routes dogfood demo on
		// top of the base skeleton (no sample overlay — a lib's routes are
		// the dogfood demo, not the app sample). Overwrites the base +page
		// pair with the dogfood demo that imports #lib.
		cpSync(join(templates, 'lib', 'src'), join(root, 'src'), { recursive: true })
	}
	// Only placeholders: project name (+ engine version pin in package.json).
	// SSR: swap the `swelte` import to the QJS adapter + add the dep.
	// The reusable-V sample adds only V export metadata to the shared manifest.
	const placeholderFiles = [
		'package.json',
		'README.md',
		'vite.config.ts',
		'svelte.config.js',
		'index.html',
		'src/routes/+page.svelte',
		'src/routes/+page.v',
		...(wantLibSample ? ['src/lib/hello/api.v'] : []),
	]
	for (const rel of placeholderFiles) {
		const abs = join(root, rel)
		if (!existsSync(abs)) continue
		let text = readFileSync(abs, 'utf8').split('__NAME__').join(name)
		const depVersion = (dep: string) => TEMPLATE_DEPS[dep] ?? VERSION
		if (wantSsr) {
			text = text
				.split(`"@swelte/core": "^__SWELTE_VERSION_core__"`)
				.join(
					`"@swelte/core": "^${depVersion('@swelte/core')}",\n    "@swelte/ssr-qjs": "^${depVersion('@swelte/ssr-qjs')}"`
				)
				.split(`import { swelte } from '@swelte/core/vite'`)
				.join(`import { swelte } from '@swelte/ssr-qjs'`)
				.split('__SWELTE_VERSION_core__')
				.join(depVersion('@swelte/core'))
				.split('__SWELTE_VERSION_vvm__')
				.join(depVersion('@swelte/vvm'))
				.split('__SWELTE_VERSION_ssr-qjs__')
				.join(depVersion('@swelte/ssr-qjs'))
		} else {
			text = text
				.split('__SWELTE_VERSION_core__')
				.join(depVersion('@swelte/core'))
				.split('__SWELTE_VERSION_vvm__')
				.join(depVersion('@swelte/vvm'))
		}
		if (wantLibSample && rel === 'package.json') {
			const pkg = JSON.parse(text) as Record<string, unknown>
			// Publication paths and scripts come from the shared base template.
			const exports = pkg.exports as Record<string, unknown>
			exports['./v/hello.v'] = { types: './package/hello.d.ts' }
			pkg.swelte = {
				v: {
					exports: {
						'./hello.v': {
							source: './src/lib/hello',
							entry: './src/lib/hello/api.v',
							target: 'universal',
						},
					},
				},
			}
			text = `${JSON.stringify(pkg, null, 2)}\n`
		}
		writeFileSync(abs, text)
	}
	log(
		`scaffolded ${wantLibSample ? 'reusable-V sample' : wantSample ? 'sample' : 'empty'}${wantSsr ? ' +ssr' : ''} project at ${root}`
	)
	if (interactive)
		outro(
			wantLibSample
				? `next: cd ${target} && npm install && swelte dev (dogfood demo) / npm run package (library build)`
				: `next: cd ${target} && npm install && swelte dev`
		)
	else
		log(
			wantLibSample
				? `next: cd ${root} && npm install && swelte dev (dogfood demo) / npm run package (library build)`
				: `next: cd ${root} && npm install && swelte dev`
		)
}
