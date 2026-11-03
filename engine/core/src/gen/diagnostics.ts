// Shared `swelte check` diagnostics: warning collection without side effects.
// `generate()` in vite.ts emits files (types, stubs, dispatcher); this module
// runs the same scans and returns `{ file, line, kind, message }` entries so
// `swelte check` (human + `--format json`) and generate-time warns agree.
// Subset: SSE *shape* checks (emit fn vs []string, duplicate qualifiers)
// stay build errors in generate() only (diagnostics warns types/orphans/clashes).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parseStructs, parseVFile } from '../vite/parse.js'
import { loadConfig } from './config.js'
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

/** Collect warnings for a project root (mirrors generate() warn sites). */
export async function collectDiagnostics(root: string): Promise<Diagnostic[]> {
	const cfg = await loadConfig(root)
	const routesDir = cfg.routesDir
	const libDir = cfg.libDir
	const routesAbs = resolve(root, routesDir)
	const libAbs = resolve(root, libDir)
	const out: Diagnostic[] = []
	const warn = (file: string, kind: string, message: string, line = 1) => {
		out.push({ file, line, kind, message })
	}
	if (existsSync(routesAbs)) {
		for (const f of listVFiles(routesAbs)) {
			const rel = relPosix(routesAbs, f)
			const mod = rel.replace(/\.v$/, '')
			if (mod === 'index' || mod === '+page' || mod.startsWith('api/')) continue
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
		// Nested +error guard: only the global is recognized.
		for (const f of listFilesWithExt(routesAbs, '.svelte')) {
			const rel = relPosix(routesAbs, f)
			const mod = rel.replace(/\.svelte$/, '')
			const slash = mod.lastIndexOf('/')
			const base = slash < 0 ? mod : mod.slice(slash + 1)
			const dir = slash < 0 ? '' : mod.slice(0, slash)
			if (base === '+error' && dir !== '') {
				warn(
					`${routesDir}/${rel}`,
					'ssr-error',
					routesDir +
						'/' +
						rel +
						' is not allowed — only src/routes/+error.svelte exists (single global error boundary)'
				)
			}
		}
	}
	try {
		const srcAbs = resolve(root, 'src')
		if (existsSync(srcAbs)) {
			const rBase = routesDir.startsWith('src/') ? routesDir.slice(4) : routesDir
			const lBase = libDir.startsWith('src/') ? libDir.slice(4) : libDir
			for (const f of listVFiles(srcAbs)) {
				const rel = f
					.slice(srcAbs.length + 1)
					.split(sep)
					.join('/')
				if (rel === rBase || rel.startsWith(`${rBase}/`)) continue
				if (rel === lBase || rel.startsWith(`${lBase}/`)) continue
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
