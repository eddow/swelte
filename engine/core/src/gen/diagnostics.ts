// Shared `swelte check` diagnostics: warning collection without side effects.
// `generate()` in vite.ts emits files (types, stubs, dispatcher); this module
// runs the same scans and returns `{ file, line, kind, message }` entries so
// `swelte check` (human + `--format json`) and generate-time warns agree.
// Subset: SSE *shape* checks (emit fn vs []string, duplicate qualifiers)
// stay build errors in generate() only (diagnostics warns types/orphans/clashes).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { validateNpmVExports } from '../vite/npm-v.js'
import { parseStructs, parseVFile } from '../vite/parse.js'
import { assertPluginCli, assertPluginName, collectPluginDeclarations } from '../vite/plugins.js'
import type { SweltePlugin } from '../vite/types.js'
import { loadConfig, loadProjectSweltePlugins } from './config.js'
import { isBackendMod } from './paths.js'

function listFilesWithExt(dir: string, ext: string): string[] {
	const out: string[] = []
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name)
			if (e.isDirectory()) {
				walk(p)
				continue
			}
			if (e.name.endsWith(ext)) out.push(p)
		}
	}
	try {
		walk(dir)
	} catch {
		/* missing dir */
	}
	return out.sort()
}

export interface Diagnostic {
	file: string
	line: number
	kind: string
	message: string
}

function listVFiles(dir: string): string[] {
	const out: string[] = []
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name)
			if (e.isDirectory()) {
				walk(p)
				continue
			}
			if (e.name.endsWith('.v')) out.push(p)
		}
	}
	try {
		walk(dir)
	} catch {
		/* missing dir */
	}
	return out.sort()
}

function relPosix(abs: string, f: string): string {
	return f
		.slice(abs.length + 1)
		.split(sep)
		.join('/')
}

/** Collect warnings for a project root (mirrors generate() warn sites).
 * With `{ lib: true }`, additionally validates the library schema from
 * `docs/libraries.md` (no side effects): `swelte.v.exports` rules plus
 * `exports`/`files` packaging coverage and the no-`src/routes`-leak rule.
 * Library-schema violations surface as `lib-*` diagnostics (warnings, same
 * as every other `check` entry — never build errors). */
export async function collectDiagnostics(
	root: string,
	opts: { lib?: boolean } = {}
): Promise<Diagnostic[]> {
	const cfg = await loadConfig(root)
	const routesDir = cfg.routesDir
	const libDir = cfg.libDir
	const routesAbs = resolve(root, routesDir)
	const libAbs = resolve(root, libDir)
	const out: Diagnostic[] = []
	const warn = (file: string, kind: string, message: string, line = 1) => {
		out.push({ file, line, kind, message })
	}
	// §1: `swelte check` resolves the same configured plugins as
	// dev/build/CLI (loadProjectSweltePlugins) and validates them
	// read-only: malformed names, bad cli shapes and plugin validate()/
	// generate() failures surface as `plugin-*` diagnostics (no writes,
	// no command execution).
	try {
		const plugins = await loadProjectSweltePlugins(root)
		out.push(...(await collectPluginDiagnostics(root, plugins, { routesDir, libDir })))
	} catch (e) {
		warn('svelte.config.js', 'plugin-config', (e as Error).message.replace(/^\[swelte\] /, ''))
	}
	if (opts.lib)
		out.push(...collectLibDiagnostics(root, { routesDir: cfg.routesDir, distDir: cfg.distDir }))
	if (existsSync(routesAbs)) {
		for (const f of listVFiles(routesAbs)) {
			const rel = relPosix(routesAbs, f)
			const mod = rel.replace(/\.v$/, '')
			if (mod === 'index' || mod === '+page' || mod.startsWith('api/')) continue
			// JSON-only leaves need no .svelte partner (examples/tests
			// dyn-items/[id].v): a verb/@[rpc] without @[load] never paints
			// HTML, so requiring a page would flag every API-shaped route.
			let src = ''
			try {
				src = readFileSync(f, 'utf8')
			} catch {
				src = ''
			}
			if (src && !/@\[\s*load\b/.test(src)) continue
			const sveltePage = join(routesAbs, mod, '+page.svelte')
			const svelteIndex = join(routesAbs, mod, 'index.svelte')
			const svelteMatch = join(
				routesAbs,
				`${mod.replace(/\[\.\.\.[^\]]+\]/g, 'x').replace(/\[[^\]]+\]/g, 'x')}.svelte`
			)
			let ok = false
			try {
				ok = existsSync(sveltePage) || existsSync(svelteIndex) || existsSync(svelteMatch)
			} catch {
				ok = false
			}
			if (!ok)
				warn(
					`${routesDir}/${rel}`,
					'orphan',
					routesDir +
						'/' +
						mod +
						'.v: no .svelte partner (page) and not under api/ -- orphan route file'
				)
		}
		try {
			const seen = new Set([
				...listVFiles(routesAbs).map((f) => relPosix(routesAbs, f).replace(/\.v$/, '')),
				...listFilesWithExt(routesAbs, '.svelte').map((f) =>
					relPosix(routesAbs, f).replace(/\.svelte$/, '')
				),
			])
			for (const mod of seen) {
				for (const leafName of ['index', '+page']) {
					if (mod !== leafName && seen.has(`${mod}/${leafName}`)) {
						warn(
							`${routesDir}/${mod}.v`,
							'clash',
							routesDir +
								'/' +
								mod +
								'.v clashes with ' +
								routesDir +
								'/' +
								mod +
								'/' +
								leafName +
								'.v -- ambiguous route'
						)
					}
				}
			}
		} catch {
			/* ignore */
		}
	}
	try {
		const srcAbs = resolve(root, 'src')
		if (existsSync(srcAbs)) {
			const rBase = routesDir.startsWith('src/') ? routesDir.slice(4) : routesDir
			const lBase = libDir.startsWith('src/') ? libDir.slice(4) : libDir
			// Framework-owned singletons: lifecycle hooks + param matchers
			// live directly under src/ by design (see docs/coming-from-sveltekit.md).
			const owned = new Set(['app.v', 'matchers.v'])
			for (const f of listVFiles(srcAbs)) {
				const rel = f
					.slice(srcAbs.length + 1)
					.split(sep)
					.join('/')
				if (rel === rBase || rel.startsWith(`${rBase}/`)) continue
				if (rel === lBase || rel.startsWith(`${lBase}/`)) continue
				if (owned.has(rel)) continue
				warn(
					`src/${rel}`,
					'stray',
					`src/${rel}: .v outside routes/ + lib/ -- ignored (never routed, never typed)`
				)
			}
		}
	} catch {
		/* ignore */
	}
	if (existsSync(libAbs)) {
		{
			const bad: string[] = []
			const walk = (dir: string) => {
				for (const e of readdirSync(dir, { withFileTypes: true })) {
					const abs = join(dir, e.name)
					if (e.isDirectory()) {
						walk(abs)
						continue
					}
					if (/\.(ts|js|mjs|cjs|svelte)$/.test(e.name)) {
						const rel = abs
							.split(sep)
							.join('/')
							.slice(libAbs.split(sep).join('/').length + 1)
						if (rel.split('/').includes('backend')) bad.push(`${libDir}/${rel}`)
					}
				}
			}
			try {
				walk(libAbs)
			} catch {
				/* ignore */
			}
			for (const b of bad)
				warn(
					b,
					'backend-ts',
					`${b}: backend/ runs purely on V -- no TS/JS/Svelte here (move it out of backend/)`
				)
		}
		for (const f of listVFiles(libAbs)) {
			const rel = relPosix(libAbs, f)
			const mod = rel.replace(/\.v$/, '')
			let src = ''
			try {
				src = readFileSync(f, 'utf8')
			} catch {
				continue
			}
			if (isBackendMod(mod)) continue
			const allFns = parseVFile(src)
			for (const vf of allFns.filter((x) => x.attr !== 'rpc')) {
				warn(
					`${libDir}/${rel}`,
					'attr',
					libDir +
						'/' +
						mod +
						'.v: @[' +
						vf.attr +
						'] on ' +
						vf.name +
						' is ignored in #lib -- only @[rpc] exposes (still exported as RPC)'
				)
			}
			for (const st of parseStructs(src)) {
				for (const fld of st.fields) {
					if (fld.tstype === 'unknown')
						warn(
							`${libDir}/${rel}`,
							'type',
							'lib/' +
								mod +
								'.' +
								st.name +
								'.' +
								fld.name +
								": unknown V type '" +
								fld.vtype +
								"' -> unknown"
						)
				}
			}
			for (const fn of allFns) {
				for (const p of fn.params) {
					if (p.tstype === 'unknown')
						warn(
							`${libDir}/${rel}`,
							'type',
							'lib/' +
								mod +
								'.' +
								fn.name +
								' param ' +
								p.name +
								": unknown V type '" +
								p.vtype +
								"' -> unknown"
						)
				}
				if (fn.tsret === 'unknown' && fn.vret !== 'unknown')
					warn(
						`${libDir}/${rel}`,
						'type',
						`lib/${mod}.${fn.name}: return: unknown V type '${fn.vret}' -> unknown`
					)
			}
		}
		if (existsSync(routesAbs)) {
			for (const f of listVFiles(routesAbs)) {
				const rel = relPosix(routesAbs, f)
				const mod = rel.replace(/\.v$/, '')
				let src = ''
				try {
					src = readFileSync(f, 'utf8')
				} catch {
					continue
				}
				for (const st of parseStructs(src)) {
					for (const fld of st.fields) {
						if (fld.tstype === 'unknown')
							warn(
								`${routesDir}/${rel}`,
								'type',
								'routes/' +
									mod +
									'.' +
									st.name +
									'.' +
									fld.name +
									": unknown V type '" +
									fld.vtype +
									"' -> unknown"
							)
					}
				}
				for (const fn of parseVFile(src)) {
					for (const p of fn.params) {
						// Harness-injected tails (room-mode SSE + WS): the
						// harness supplies them; never user-facing types.
						if (fn.attr === 'sse' || fn.attr === 'ws') {
							const tail2 =
								/^fn\s*\(\s*string\s*\)(\s*bool)?$/.test(p.vtype.trim()) ||
								/^fn\s*\(\s*string\s*\)\s*chan\s+string$/.test(p.vtype.trim()) ||
								/^chan\s+string$/.test(p.vtype.trim())
							if (tail2 && fn.params.indexOf(p) >= fn.params.length - 3) continue
						}
						if (p.tstype === 'unknown')
							warn(
								`${routesDir}/${rel}`,
								'type',
								'routes/' +
									mod +
									'.' +
									fn.name +
									' param ' +
									p.name +
									": unknown V type '" +
									p.vtype +
									"' -> unknown"
							)
					}
					if (fn.tsret === 'unknown' && fn.vret !== 'unknown')
						warn(
							`${routesDir}/${rel}`,
							'type',
							'routes/' +
								mod +
								'.' +
								fn.name +
								": return: unknown V type '" +
								fn.vret +
								"' -> unknown"
						)
				}
			}
		}
	}
	return out.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind))
}

interface LibPackageJson {
	[K: string]: unknown
	name?: unknown
	files?: unknown
	exports?: unknown
	swelte?: {
		v?: {
			exports?: Record<string, { source?: unknown; entry?: unknown; target?: unknown }>
		}
	}
}

/** Library-schema checks (`swelte check --lib`, see `docs/libraries.md`).
 * Pure reads over `package.json` + the declared V sources: no staging, no
 * tarball, no build. Every violation is a `lib-*` warning. */
export function collectLibDiagnostics(
	root: string,
	opts: { output?: string; routesDir?: string; distDir?: string } = {}
): Diagnostic[] {
	const out: Diagnostic[] = []
	const warn = (file: string, kind: string, message: string, line = 1) => {
		out.push({ file, line, kind, message })
	}
	const abs = resolve(root)
	let pkg: LibPackageJson
	try {
		pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')) as LibPackageJson
	} catch (error) {
		warn('package.json', 'lib-manifest', `cannot read package.json: ${(error as Error).message}`)
		return out.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind))
	}
	// 1. `swelte.v.exports` — same rules as the consumer path (shared validator).
	let validated: {
		exportKey: string
		specifier: string
		target: string
		sourceDir: string
		entryFile: string
	}[] = []
	try {
		validated = validateNpmVExports(abs, pkg as never)
	} catch (error) {
		warn(
			'package.json',
			'lib-exports',
			(error as Error).message.replace(/^\[swelte\] /, 'swelte.v.exports: ')
		)
		return out.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind))
	}
	// 2. `exports` coverage: Svelte entries + package.json passthrough + ./v/*.v.
	const exportsMap =
		pkg.exports && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports)
			? (pkg.exports as Record<string, unknown>)
			: null
	if (!exportsMap) {
		warn(
			'package.json',
			'lib-exports',
			'missing exports map (expected ".", "./package.json" and per-file Svelte entries)'
		)
	} else {
		if (!('./package.json' in exportsMap))
			warn('package.json', 'lib-exports', 'exports misses "./package.json" passthrough')
		for (const v of validated) {
			const tsSpecifier = `${typeof pkg.name === 'string' ? pkg.name : '<name>'}/v/${v.exportKey.slice(2)}`
			if (!(v.specifier in exportsMap) && !(`./v/${v.exportKey.slice(2)}` in exportsMap))
				warn(
					'package.json',
					'lib-exports',
					`exports misses "${`./v/${v.exportKey.slice(2)}`}" for V export ${v.exportKey} (TS imports ${tsSpecifier})`
				)
		}
	}
	// 3. `files`: Svelte output + V sources in, dogfood out.
	const files = Array.isArray(pkg.files)
		? pkg.files.filter((f): f is string => typeof f === 'string')
		: null
	if (!files) {
		warn(
			'package.json',
			'lib-files',
			'missing files allowlist (expected package output + src/lib V sources, never src/routes)'
		)
	} else {
		const output = opts.output ?? 'package'
		const coversOutput = files.some((f) => f.replace(/\/$/, '') === output)
		if (!coversOutput)
			warn('package.json', 'lib-files', `files misses "${output}" (library output)`)
		for (const v of validated) {
			const rel = v.sourceDir
				.slice(abs.length + 1)
				.split(sep)
				.join('/')
			const covered = files.some(
				(f) =>
					rel === f ||
					rel.startsWith(`${f.replace(/\/\*\*\/\*\.v$/, '').replace(/\/\*\*$/, '')}/`) ||
					f.includes('.v')
			)
			if (!covered)
				warn(
					'package.json',
					'lib-files',
					`files misses V source "${rel}" for export ${v.exportKey}`
				)
		}
		const includesDirectory = (dir: string) =>
			files.some((pattern) => {
				const f = pattern.replace(/^\.\//, '').replace(/\/$/, '')
				const base = f.split(/[*?{[]/)[0].replace(/\/$/, '')
				return (
					base === '' || dir === base || dir.startsWith(`${base}/`) || base.startsWith(`${dir}/`)
				)
			})
		if (includesDirectory(opts.distDir ?? 'dist'))
			warn(
				'package.json',
				'lib-app-leak',
				'files would publish application output; include only the library output'
			)
		if (includesDirectory(opts.routesDir ?? 'src/routes')) {
			warn(
				'package.json',
				'lib-routes-leak',
				'files would publish src/routes dogfood (demo/test only — never published)'
			)
		}
	}
	return out.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind))
}

/** §1 plugin validation for `swelte check` (read-only, no writes).
 *  Resolves like generate(): deduped names, collected declarations across
 *  app/routes/lib, then per-plugin `validate()` + dry-run `generate()`.
 *  Failures become `plugin-*` diagnostics (file+line); `generate()` output
 *  is validated (names/collisions) but never written and never pruned.
 *  CLI commands are validated by shape only (`assertPluginCli`) — never run. */
export async function collectPluginDiagnostics(
	root: string,
	plugins: SweltePlugin[],
	opts: { routesDir: string; libDir: string },
): Promise<Diagnostic[]> {

	const out: Diagnostic[] = []
	const routesAbs = resolve(root, opts.routesDir)
	const libAbs = resolve(root, opts.libDir)
	const readAll = (abs: string) => {
		const found: { file: string; modulePath: string; source: string }[] = []
		for (const f of listVFiles(abs)) {
			try {
				const rel = relPosix(abs, f)
				found.push({
					file: `${abs === routesAbs ? opts.routesDir : opts.libDir}/${rel}`,
					modulePath: rel.replace(/\.v$/, ''),
					source: readFileSync(f, 'utf8'),
				})
			} catch { /* unreadable — generate reports */ }
		}
		return found
	}
	try {
		for (const plugin of plugins) assertPluginName(plugin?.name)
	} catch (e) {
		out.push({ file: 'svelte.config.js', line: 1, kind: 'plugin-config', message: (e as Error).message.replace(/^\[swelte\] /, '') })
		return out.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind))
	}
	let app: { file: string; modulePath: string; source: string } | null = null
	try {
		app = { file: 'src/app.v', modulePath: 'app', source: readFileSync(join(root, 'src', 'app.v'), 'utf8') }
	} catch { /* absent — no app declarations */ }
	const routes = readAll(routesAbs)
	const libFiles = readAll(libAbs)
	const claims = collectPluginDeclarations(
		plugins,
		{
			app,
			routes,
			libs: libFiles.map((l) => ({ kind: (isBackendMod(l.modulePath) ? 'backend' : 'lib') as 'backend' | 'lib', ...l })),
		},
		parseVFile,
		parseStructs,
	)
	for (const plugin of plugins) {
		const decls = claims.get(plugin.name) ?? []
		try {
			assertPluginCli(plugin.name, plugin.cli ?? [])
		} catch (e) {
		out.push({ file: 'svelte.config.js', line: 1, kind: 'plugin-cli', message: (e as Error).message.replace(/^\[swelte\] /, '') })
		}
		for (const decl of decls) {
			try {
				plugin.validate?.(decl.file, { name: decl.fn.name, attr: decl.fn.attr }, decl as never)
			} catch (e) {
				out.push({ file: decl.file, line: decl.line, kind: 'plugin-validate', message: (e as Error).message.replace(/^\[swelte\] /, '') })
			}
		}
		if (plugin.generate) {
			try {
				const outputs = plugin.generate({ dirs: { routesDir: opts.routesDir, libDir: opts.libDir, outDir: '.swelte' }, declarations: decls as never, config: undefined } as never) ?? {}
				const seen = new Set<string>()
				for (const [file, body] of Object.entries(outputs)) {
					if (!/^[A-Za-z0-9][\w.-]*(\/[\w.-]+)*\.[A-Za-z0-9]+$/.test(file) || file.split('/').includes('..'))
						throw new Error(`plugin ${plugin.name}: invalid output file '${file}'`)
					if (['routes', 'generated', 'types', 'app', 'dev'].includes(file.split('/')[0] ?? ''))
						throw new Error(`plugin ${plugin.name}: output '${file}' collides with a core dir`)
					if (typeof body !== 'string') throw new Error(`plugin ${plugin.name}: output '${file}' must be a string`)
					if (seen.has(file)) throw new Error(`plugin ${plugin.name}: duplicate output '${file}'`)
					seen.add(file)
				}
			} catch (e) {
				out.push({ file: `plugin:${plugin.name}`, line: 1, kind: 'plugin-generate', message: (e as Error).message.replace(/^\[swelte\] /, '') })
			}
		}
	}
	return out.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind))
}

