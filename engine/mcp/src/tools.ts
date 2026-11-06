// MCP tools: route tree, per-route detail, diagnostics, config.
// Reuses @swelte/core dist (config, diagnostics, route helpers) — no
// reimplementation of route mapping or warning logic.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { loadConfig } from '@swelte/core/config'
import { collectDiagnostics } from '@swelte/core/diagnostics'
import type { RpcFn } from '@swelte/core/vite'
import {
	loadMatchers,
	modulePath,
	parseStructs,
	parseVFile,
	relPosix,
	routeFor,
	routeParams,
	svelteModKind,
	svelteRouteFor,
} from '@swelte/core/vite'
import { VERSION } from './version.js'

export interface ToolDef {
	name: string
	description: string
	inputSchema: Record<string, unknown>
}

export const TOOLS: ToolDef[] = [
	{
		name: 'list_routes',
		description:
			'List the Swelte route tree: each .v route file mapped to its URL path, RPC functions, and .svelte partner.',
		inputSchema: {
			type: 'object',
			properties: { root: { type: 'string', description: 'Project root (default: cwd)' } },
		},
	},
	{
		name: 'get_route',
		description:
			'Detail for one route: V functions with params/return types, structs, and the .svelte sibling if any.',
		inputSchema: {
			type: 'object',
			properties: {
				root: { type: 'string', description: 'Project root (default: cwd)' },
				route: { type: 'string', description: 'URL path, e.g. /users/[id]' },
			},
			required: ['route'],
		},
	},
	{
		name: 'check',
		description:
			'Run `swelte check` diagnostics: orphans, clashes, unknown V types, backend/ violations.',
		inputSchema: {
			type: 'object',
			properties: { root: { type: 'string', description: 'Project root (default: cwd)' } },
		},
	},
	{
		name: 'get_config',
		description: 'Resolved Swelte project config (routesDir, libDir, outDir, ports, policy flags).',
		inputSchema: {
			type: 'object',
			properties: { root: { type: 'string', description: 'Project root (default: cwd)' } },
		},
	},
	{
		name: 'validate_data_contract',
		description:
			'Verify type compatibility between a V route response struct and the corresponding Svelte 5 component $props().',
		inputSchema: {
			type: 'object',
			properties: {
				root: { type: 'string', description: 'Project root (default: cwd)' },
				route: { type: 'string', description: 'URL path to inspect, e.g. /users/[id]' },
			},
			required: ['route'],
		},
	},
	{
		name: 'scaffold_route',
		description:
			'Create a new Swelte route pairing (+route.v and +page.svelte) with boilerplate data loaders and runes.',
		inputSchema: {
			type: 'object',
			properties: {
				root: { type: 'string', description: 'Project root (default: cwd)' },
				route: { type: 'string', description: 'URL path for the new route, e.g. /dashboard' },
				mode: { type: 'string', description: 'Route type: "static" | "dynamic" | "api"' },
			},
			required: ['route'],
		},
	},
	{
		name: 'explain_bytecode_error',
		description:
			'Map a QuickJS runtime stack trace or error back to the original .svelte or .v source line using Vite source-maps.',
		inputSchema: {
			type: 'object',
			properties: {
				root: { type: 'string', description: 'Project root (default: cwd)' },
				stack_trace: { type: 'string', description: 'Raw stack trace string from server logs' },
			},
			required: ['stack_trace'],
		},
	},
]

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

function listSvelteFiles(dir: string): string[] {
	const out: string[] = []
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name)
			if (e.isDirectory()) {
				if (e.name === '.swelte') continue
				walk(p)
				continue
			}
			if (e.name.endsWith('.svelte')) out.push(p)
		}
	}
	try {
		walk(dir)
	} catch {
		/* missing dir */
	}
	return out.sort()
}

export interface RouteEntry {
	route: string
	file: string
	params: string[]
	functions: { name: string; attr: string; params: string; returns: string }[]
	svelte: string | null
}

function sveltePartner(routesAbs: string, mod: string): string | null {
	const base = join(routesAbs, mod)
	for (const cand of [`${base}.svelte`, join(routesAbs, mod, '+page.svelte')]) {
		if (existsSync(cand)) return relative(routesAbs, cand).split(sep).join('/')
	}
	// Dynamic file partner: users/[id].v <-> users/[id].svelte already
	// covered by `${base}.svelte`; folder leaf covered above.
	return null
}

/** Scan routesDir into route entries (mirrors core generate() mapping). */
export function scanRoutes(root: string, routesDir: string, routesAbs: string): RouteEntry[] {
	const out: RouteEntry[] = []
	let known: Set<string> | undefined
	try {
		known = new Set(loadMatchers(root).keys())
	} catch {
		known = undefined
	}
	for (const f of listVFiles(routesAbs)) {
		const mod = modulePath(routesAbs, f)
		const route = routeFor(routesDir, routesAbs, f, known)
		if (route === null) continue // +route wrapper — not a URL
		let src = ''
		try {
			src = readFileSync(f, 'utf8')
		} catch {
			continue
		}
		const fns = parseVFile(src).map((fn: RpcFn) => ({
			name: fn.name,
			attr: fn.attr,
			params: fn.params.map((p) => `${p.name}: ${p.tstype}`).join(', '),
			returns: fn.tsret,
		}))
		out.push({
			route,
			file: `${routesDir}/${relPosix(routesAbs, f)}`,
			params: routeParams(route),
			functions: fns,
			svelte: sveltePartner(routesAbs, mod),
		})
	}
	// Static .svelte pages with no .v partner (pure static HTML/JS).
	const vMods = new Set(
		listVFiles(routesAbs).map((f) => relPosix(routesAbs, f).replace(/\.v$/, ''))
	)
	for (const f of listSvelteFiles(routesAbs)) {
		const mod = relPosix(routesAbs, f).replace(/\.svelte$/, '')
		if (vMods.has(mod)) continue
		const kind = svelteModKind(mod)
		if (kind === null || kind === 'wrapper' || kind === 'error') continue
		const route = svelteRouteFor(mod)
		if (route === null) continue
		if (out.some((e) => e.route === route)) continue
		out.push({
			route,
			file: `${routesDir}/${relPosix(routesAbs, f)}`,
			params: routeParams(route),
			functions: [],
			svelte: relPosix(routesAbs, f),
		})
	}
	return out.sort((a, b) => a.route.localeCompare(b.route))
}

function rootOf(params: Record<string, unknown>): string {
	const raw = params.root
	return resolve(typeof raw === 'string' && raw !== '' ? raw : process.cwd())
}

async function listRoutes(params: Record<string, unknown>): Promise<{ routes: RouteEntry[] }> {
	const root = rootOf(params)
	const cfg = await loadConfig(root)
	return { routes: scanRoutes(root, cfg.routesDir, resolve(root, cfg.routesDir)) }
}

async function getRoute(
	params: Record<string, unknown>
): Promise<{ route: RouteEntry & { structs: unknown; source: string } }> {
	const wanted = params.route
	if (typeof wanted !== 'string' || wanted === '') throw new Error('missing required param: route')
	const root = rootOf(params)
	const cfg = await loadConfig(root)
	const routesAbs = resolve(root, cfg.routesDir)
	const entries = scanRoutes(root, cfg.routesDir, routesAbs)
	const entry = entries.find((e) => e.route === wanted)
	if (!entry) throw new Error(`unknown route: ${wanted}`)
	const abs = resolve(root, entry.file)
	let src = ''
	try {
		src = readFileSync(abs, 'utf8')
	} catch {
		throw new Error(`cannot read ${entry.file}`)
	}
	return { route: { ...entry, structs: parseStructs(src), source: src } }
}

async function check(params: Record<string, unknown>): Promise<{ diagnostics: unknown[] }> {
	const diagnostics = await collectDiagnostics(rootOf(params))
	return { diagnostics }
}

async function getConfig(params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const root = rootOf(params)
	const cfg = await loadConfig(root)
	let stat: { mtime: string } | null = null
	try {
		const st = statSync(join(root, 'svelte.config.js'))
		stat = { mtime: st.mtime.toISOString() }
	} catch {
		/* no config file */
	}
	return { root, ...cfg, configStat: stat, server: VERSION }
}

/** Extract `$props()` type fields from a .svelte file (best-effort regex). */
function sveltePropsFields(src: string): { name: string; optional: boolean; tstype: string }[] {
	const m = /=\s*\$props\(\)/.exec(src)
	if (!m) return []
	const before = src.slice(0, m.index)
	const decl = /(?:let|const)\s*\{([^}]*)\}\s*(?::\s*\{([^}]*)\})?/.exec(
		before.slice(Math.max(0, before.length - 600))
	)
	if (!decl) return []
	const names = decl[1]
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => {
			const eq = s.indexOf('=')
			const name = (eq >= 0 ? s.slice(0, eq) : s).trim().replace(/^\.\.\./, '')
			return { name, optional: eq >= 0 }
		})
	const types = new Map<string, string>()
	if (decl[2]) {
		for (const part of decl[2].split(';')) {
			const fm = /([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:\s*([^;]+)/.exec(part.trim())
			if (fm) types.set(fm[1], fm[2].trim())
		}
	}
	return names.map((n) => ({ ...n, tstype: types.get(n.name) ?? 'unknown' }))
}

async function validateDataContract(
	params: Record<string, unknown>
): Promise<{ route: string; matches: unknown[]; mismatches: unknown[] }> {
	const wanted = params.route
	if (typeof wanted !== 'string' || wanted === '') throw new Error('missing required param: route')
	const root = rootOf(params)
	const cfg = await loadConfig(root)
	const routesAbs = resolve(root, cfg.routesDir)
	const entries = scanRoutes(root, cfg.routesDir, routesAbs)
	const entry = entries.find((e) => e.route === wanted)
	if (!entry) throw new Error(`unknown route: ${wanted}`)
	const vAbs = resolve(root, entry.file)
	let vsrc = ''
	try {
		vsrc = readFileSync(vAbs, 'utf8')
	} catch {
		throw new Error(`cannot read ${entry.file}`)
	}
	const structs = parseStructs(vsrc)
	const fns = parseVFile(vsrc)
	// Response struct = return type of the @[load] fn, else first struct.
	const loadFn = fns.find((f) => f.attr === 'load')
	const retName = loadFn ? loadFn.tsret.replace(/\s*\|\s*null$/, '') : null
	const vStruct = structs.find((s) => s.name === retName) ?? structs[0] ?? null
	let props: { name: string; optional: boolean; tstype: string }[] = []
	if (entry.svelte) {
		try {
			props = sveltePropsFields(readFileSync(join(routesAbs, entry.svelte), 'utf8'))
		} catch {
			/* unreadable svelte */
		}
	}
	const matches: unknown[] = []
	const mismatches: unknown[] = []
	if (!vStruct) {
		mismatches.push({ reason: 'no V struct found in route file' })
		return { route: wanted, matches, mismatches }
	}
	if (props.length === 0) {
		mismatches.push({ reason: 'no $props() found in .svelte partner', struct: vStruct.name })
		return { route: wanted, matches, mismatches }
	}
	for (const fld of vStruct.fields) {
		const p = props.find((x) => x.name === fld.name)
		if (!p) {
			mismatches.push({ field: fld.name, vtype: fld.tstype, reason: 'missing from $props()' })
			continue
		}
		const norm = (t: string) =>
			t
				.replace(/\s*\|\s*null$/, '')
				.replace(/\s*\?$/, '')
				.trim()
		if (norm(p.tstype) === 'unknown' || norm(p.tstype) === norm(fld.tstype)) {
			matches.push({ field: fld.name, vtype: fld.tstype, propType: p.tstype })
		} else {
			mismatches.push({ field: fld.name, vtype: fld.tstype, propType: p.tstype })
		}
	}
	return { route: wanted, matches, mismatches }
}

/** Map a URL route to the on-disk directory holding its files. */
function routeDirFor(routesAbs: string, route: string): string {
	const segs = route.split('/').filter(Boolean)
	return join(routesAbs, ...segs)
}

function vModuleName(route: string, mode: string): string {
	const segs = route.split('/').filter(Boolean)
	const clean = segs.map((s) => s.replace(/[^A-Za-z0-9_]/g, '_')).join('_') || 'index'
	return mode === 'api' ? clean : `${clean}_page`
}

async function scaffoldRoute(
	params: Record<string, unknown>
): Promise<{ created: string[]; route: string }> {
	const wanted = params.route
	if (typeof wanted !== 'string' || wanted === '' || !wanted.startsWith('/'))
		throw new Error('missing required param: route (URL path starting with /)')
	const mode = params.mode === undefined ? 'static' : params.mode
	if (mode !== 'static' && mode !== 'dynamic' && mode !== 'api')
		throw new Error('invalid mode: must be "static" | "dynamic" | "api"')
	const root = rootOf(params)
	const cfg = await loadConfig(root)
	const routesAbs = resolve(root, cfg.routesDir)
	const dir = routeDirFor(routesAbs, wanted)
	const created: string[] = []
	const ensureDir = () => {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
			created.push(`${cfg.routesDir}${wanted === '/' ? '' : wanted}/`)
		}
	}
	if (mode === 'api') {
		const leaf = wanted.split('/').filter(Boolean).pop() ?? 'index'
		const file = join(dir === routesAbs ? dir : dir, `${leaf}.v`)
		if (existsSync(file)) throw new Error(`${cfg.routesDir}${wanted}.v already exists`)
		ensureDir()
		const mod = vModuleName(wanted, mode)
		writeFileSync(
			file,
			`module ${mod}\n\n@[get]\npub fn handler(req SwelteRequest) string {\n\t_ = req\n\treturn 'ok'\n}\n`
		)
		created.push(`${cfg.routesDir}${wanted}.v`)
		return { created, route: wanted }
	}
	// Page route: +page.v + +page.svelte pair.
	const vFile = join(dir === routesAbs ? routesAbs : dir, '+page.v')
	const svelteFile = join(dir === routesAbs ? routesAbs : dir, '+page.svelte')
	if (existsSync(vFile) || existsSync(svelteFile))
		throw new Error(`${cfg.routesDir}${wanted === '/' ? '' : wanted}/+page already exists`)
	ensureDir()
	const mod = vModuleName(wanted, mode)
	const structName = `${mod
		.split('_')
		.map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
		.join('')}Props`
	const dynNote = mode === 'dynamic' ? "\t// Dynamic params: req.params['id']\n" : ''
	writeFileSync(
		dir === routesAbs ? join(routesAbs, '+page.v') : vFile,
		`module ${mod}\n\npub struct ${structName} {\npub:\n\tmessage string\n}\n\n@[load]\npub fn load_page(req SwelteRequest) !${structName} {\n${dynNote}\t_ = req\n\treturn ${structName}{\n\t\tmessage: 'Hello from ${wanted}'\n\t}\n}\n`
	)
	writeFileSync(
		dir === routesAbs ? join(routesAbs, '+page.svelte') : svelteFile,
		`<script lang="ts">\nlet { data }: { data?: { message: string } } = $props()\n</script>\n\n<main>\n\t<h1>${wanted === '/' ? 'Home' : wanted}</h1>\n\t{#if data}\n\t\t<p>{data.message}</p>\n\t{/if}\n</main>\n`
	)
	const prefix = `${cfg.routesDir}${wanted === '/' ? '' : wanted}/`
	created.push(`${prefix}+page.v`, `${prefix}+page.svelte`)
	return { created, route: wanted }
}

async function explainBytecodeError(
	params: Record<string, unknown>
): Promise<{ frames: unknown[]; hints: string[] }> {
	const trace = params.stack_trace
	if (typeof trace !== 'string' || trace === '')
		throw new Error('missing required param: stack_trace')
	const root = rootOf(params)
	const cfg = await loadConfig(root)
	const frames: unknown[] = []
	const hints: string[] = []
	// Wasm name maps (emitted next to each .wasm inside .swelte/):
	// fn name -> source .v file. Loaded lazily, only when the trace
	// mentions wasm.
	let wasmMaps: { mod: string; file: string; functions: { name: string }[] | string[] }[] | null =
		null
	const loadWasmMaps = (): {
		mod: string
		file: string
		functions: { name: string }[] | string[]
	}[] => {
		if (wasmMaps !== null) return wasmMaps
		const found: { mod: string; file: string; functions: { name: string }[] | string[] }[] = []
		wasmMaps = found
		const walk = (d: string) => {
			let entries: { name: string; isDir: boolean }[] = []
			try {
				entries = readdirSync(d, { withFileTypes: true }).map((e) => ({
					name: e.name,
					isDir: e.isDirectory(),
				}))
			} catch {
				return
			}
			for (const e of entries) {
				const p = join(d, e.name)
				if (e.isDir) {
					walk(p)
					continue
				}
				if (!e.name.endsWith('.wasm.map')) continue
				try {
					const raw = JSON.parse(readFileSync(p, 'utf8')) as
						| { mod: string; file: string; functions: { name: string }[] }
						| { modules: { mod: string; file: string; functions: string[] }[] }
					if ('modules' in raw) found.push(...raw.modules)
					else found.push(raw)
				} catch {
					/* corrupt map — skip */
				}
			}
		}
		walk(resolve(root, cfg.outDir))
		return found
	}
	const wasmSourceFor = (fn: string): string | null => {
		for (const m of loadWasmMaps()) {
			const names = m.functions.map((f) => (typeof f === 'string' ? f : f.name))
			if (names.includes(fn)) return m.file
		}
		return null
	}
	// QuickJS frames look like `at fn (file:line:col)` or `at file:line`.
	const re = /at\s+(?:([^\s(]+)\s+\()?([^()\s:]+):(\d+)(?::(\d+))?\)?/g
	let m: RegExpExecArray | null
	while ((m = re.exec(trace)) !== null) {
		const [, fn, file, line, col] = m
		const abs = resolve(root, file)
		let snippet: string | null = null
		try {
			const lines = readFileSync(abs, 'utf8').split('\n')
			const n = Number(line)
			if (n >= 1 && n <= lines.length) snippet = lines[n - 1].trim().slice(0, 200)
		} catch {
			/* generated frame or missing file */
		}
		frames.push({
			fn: fn ?? null,
			file,
			line: Number(line),
			col: col ? Number(col) : null,
			snippet,
		})
	}
	// Wasm trap frames: `wasm trap in fn_name` or bare export names —
	// resolve via the .wasm.map name maps.
	if (/wasm/i.test(trace)) {
		const fnRe = /wasm\s+trap\s+(?:in\s+|at\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi
		let fm: RegExpExecArray | null
		const seen = new Set<string>()
		while ((fm = fnRe.exec(trace)) !== null) {
			const name = fm[1]
			if (seen.has(name) || /^(trap|error|in|at)$/i.test(name)) continue
			seen.add(name)
			const src = wasmSourceFor(name)
			frames.push({
				fn: name,
				file: src,
				line: null,
				col: null,
				snippet: null,
				via: src ? '.wasm.map' : null,
			})
			if (!src)
				hints.push(
					`wasm fn '${name}' not found in ${cfg.outDir}/**/*.wasm.map — rebuild to refresh maps`
				)
		}
		if (frames.length === 0)
			hints.push('no wasm frames recognized — expected `wasm trap in <fn>` lines')
	}
	if (frames.length === 0)
		hints.push('no stack frames recognized — expected `at fn (file:line[:col])` lines')
	// Point at generated output when the trace mentions it.
	if (/\.swelte\//.test(trace))
		hints.push(
			`generated code under ${cfg.outDir}/ maps back to ${cfg.routesDir}/ + .svelte siblings — check ssr-manifest.json`
		)
	if (/\.v:\d+/.test(trace))
		hints.push('V frame — verify the handler signature matches SwelteRequest conventions')
	return { frames, hints }
}

export const HANDLERS = new Map([
	['list_routes', listRoutes],
	['get_route', getRoute],
	['check', check],
	['get_config', getConfig],
	['validate_data_contract', validateDataContract],
	['scaffold_route', scaffoldRoute],
	['explain_bytecode_error', explainBytecodeError],
])

export function serverInfo(): Record<string, unknown> {
	return {
		name: 'swelte',
		version: VERSION,
		protocolVersion: '2024-11-05',
		capabilities: { tools: {} },
	}
}
