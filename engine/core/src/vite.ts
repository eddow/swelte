import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFileSync as execVSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { loadConfig, renderClientEntry, renderHarness } from './gen/config.js'
import { isBackendMod } from './gen/paths.js'
import { resolveV, toolchainEnv } from './toolchain.js'

function list<T>(collection: readonly T[], fn: (item: T, i: number) => unknown): string {
	return collection.map(fn).join('')
}

// Lazy V binary for `v -b wasm` (resolved on first compile).
// (module import must not throw when the caller passes a plain path).
let vBin = ''

export interface SweltePluginOptions {
	routesDir?: string
	libDir?: string
	outDir?: string
	/** V backend base URL for dev RPC proxy (e.g. http://localhost:8131).
	 * Falls back to SWELTE_V_BACKEND_URL (injected by `swelte dev`). Unset = no proxy. */
	vBackendUrl?: string
}

/** Re-export the unified config type + helper so projects can
 *  `import { defineConfig } from '@swelte/core/config'` in svelte.config.js. */
export type { SwelteConfig, SwelteOptions } from './gen/config.js'
export { defineConfig } from './gen/config.js'

export interface RpcParam {
	name: string
	vtype: string
	tstype: string
	optional: boolean
}

export interface RpcFn {
	name: string
	attr: 'get' | 'post' | 'rpc' | 'put' | 'delete' | 'patch' | 'sse' | 'before' | 'after' | 'load'
	qualifier?: string
	params: RpcParam[]
	vret: string
	tsret: string
	fallible: boolean
	singleArgsStruct?: string
	setsCookie: boolean
}

/** A `@[load]` page-data loader with its source file for error messages. */
export interface LoadFn extends RpcFn {
	mod: string
	file: string
}

function splitTopLevel(s: string, sep: string): string[] {
	const out: string[] = []
	let depth = 0
	let cur = ''
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (c === '[' || c === '(' || c === '{' || c === '<') depth++
		if (c === ']' || c === ')' || c === '}' || c === '>') depth--
		if (c === sep && depth === 0) {
			out.push(cur)
			cur = ''
		} else cur += c
	}
	if (cur.trim() !== '' || out.length > 0) out.push(cur)
	return out
}

export function parseVFile(src: string): RpcFn[] {
	const structs = parseStructs(src)
	const structByName = new Map(structs.map((s) => [s.name, s]))
	const fns: RpcFn[] = []
	// V allows stacked attributes on consecutive lines (`@[rpc]` newline
	// `@[sets_cookie]` newline `pub fn`). The function regex below matches
	// the LAST bracket group before `pub fn`, so a stacked group would be
	// missed. Merge first: collapse `]\s*\n\s*@[` runs (whitespace-only span
	// between groups) into `; ` so stacked groups parse as one.
	const merged = src.replace(/\]\s*\n\s*@\[/g, '; ')
	// Single-inline `@[sets_cookie]` outside the merged group still counts:
	// pre-scan for bare carrier lines immediately (whitespace-only span)
	// followed by a verb-attribute line + `pub fn`.
	const bareSpans: { end: number; name: string }[] = []
	const bareRe = /@\[\s*sets_cookie\s*\]/g
	let bm: RegExpExecArray | null
	while ((bm = bareRe.exec(merged)) !== null) {
		bareSpans.push({ end: bm.index + bm[0].length, name: 'sets_cookie' })
	}
	const re = /@\[([^\]]*)\]\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
	let m: RegExpExecArray | null
	while ((m = re.exec(merged)) !== null) {
		// Paren-aware param scan: `emit fn (string) bool` contains
		// parens, so `([^)]*)` truncates. Walk balanced from the open
		// paren instead; the return type follows `)` up to `{`/`\n`.
		let depth = 1
		let i = m.index + m[0].length
		while (i < merged.length && depth > 0) {
			if (merged[i] === '(') depth++
			else if (merged[i] === ')') depth--
			i++
		}
		if (depth !== 0) continue
		const rawParamsFull = merged.slice(m.index + m[0].length, i - 1)
		const retMatch = /^\s*([?!]?(?:\([^)]*\)|[A-Za-z_\][\w.[\]]*))?/.exec(merged.slice(i, i + 80))
		const attrParts = splitTopLevel(m[1], ';')
		const verbs: { verb: string; qualifier?: string }[] = []
		let setsCookie = false
		for (const bs of bareSpans) {
			if (bs.end <= m.index && merged.slice(bs.end, m.index).trim() === '') {
				if (bs.name === 'sets_cookie') setsCookie = true
			}
		} // end bare-carrier attach
		for (const p of attrParts) {
			const pm =
				/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\))?\s*$/.exec(p)
			if (pm && pm[1] === 'sets_cookie' && !pm[2]) {
				setsCookie = true
				continue
			}
			if (
				pm &&
				['get', 'post', 'rpc', 'put', 'delete', 'patch', 'sse', 'before', 'after', 'load'].includes(
					pm[1]
				)
			) {
				verbs.push({ verb: pm[1], qualifier: pm[2] })
			}
		}
		if (verbs.length === 0) {
			continue
		}
		const name = m[2]
		const rawParams = (rawParamsFull ?? '').trim()
		const rawRet = (retMatch?.[1] ?? '').trim()
		let params: RpcParam[] = []
		let singleArgsStruct: string | undefined
		const parts = rawParams === '' || rawParams === 'void' ? [] : splitTopLevel(rawParams, ',')
		// Single-args-struct convention: fn takes exactly one param whose type
		// is a struct declared in the same file → expand struct fields as params.
		// e.g. `pub fn login(args LoginArgs)` with `pub struct LoginArgs { payload string }`
		// behaves as TS `login(args: { payload: string })`.
		if (parts.length === 1) {
			const p = parts[0].trim().replace(/^(mut\s+|ref\s+)/, '')
			const pm =
				/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(p) ??
				/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(p)
			if (pm) {
				const vtype = pm[2].trim().replace(/^\?/, '')
				const st = structByName.get(vtype.split('.').pop() as string)
				if (st) {
					singleArgsStruct = st.name
					params = st.fields.map((f) => ({
						name: f.name,
						vtype: f.vtype,
						tstype: f.tstype,
						optional: f.optional,
					}))
				}
			}
		}
		if (!singleArgsStruct) {
			for (const part of parts) {
				const p = part.trim().replace(/^(mut\s+|ref\s+)/, '')
				if (!p) continue
				const pm =
					/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(p) ??
					/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(p)
				if (!pm) continue
				const vtype = pm[2].trim()
				params.push({ name: pm[1], vtype, tstype: tsTypeFor(vtype), optional: /^\?/.test(vtype) })
			}
		}
		let vret = rawRet
		let fallible = false
		if (vret.startsWith('!')) {
			fallible = true
			vret = vret.slice(1).trim() || 'void'
		}
		if (vret === '' || vret === 'void') vret = 'void'
		for (const vb of verbs) {
			fns.push({
				name,
				attr: vb.verb as RpcFn['attr'],
				qualifier: vb.qualifier,
				params,
				vret,
				tsret: tsTypeFor(vret),
				fallible,
				singleArgsStruct,
				setsCookie,
			})
		}
	}
	return fns
}

function listFilesWithExt(dir: string, ext: string, base?: string): string[] {
	if (!existsSync(dir)) return []
	const root = base ?? dir
	const out: string[] = []
	// Sorted (byte order): readdir order is filesystem-dependent and made
	// routeGen flip between runs (§7). Deterministic order, always.
	for (const e of readdirSync(dir).sort()) {
		const p = join(dir, e)
		const st = statSync(p)
		// Never scan our own output (`.swelte/`) — never the input tree
		// (`src/routes/` lives under `src/`).
		if (st.isDirectory()) {
			if (e === '.swelte') continue
			out.push(...listFilesWithExt(p, ext, root))
		} else if (e.endsWith(ext)) out.push(p)
	}
	return out
}

function listVFiles(dir: string, base?: string): string[] {
	return listFilesWithExt(dir, '.v', base)
}

export function svelteModKind(mod: string): 'page' | 'wrapper' | 'error' | 'plain' | null {
	const base = mod.includes('/') ? mod.slice(mod.lastIndexOf('/') + 1) : mod
	if (base === '+page' || base === 'index') return 'page'
	if (base === '+route') return 'wrapper'
	if (base === '+error') return 'error'
	if (base.startsWith('+')) return null
	return 'plain'
}

/** URL pattern for a `.svelte` mod (mirrors routeFor leaf/dir rules).
 * Returns null for wrappers (+route) and unknown +-files. */
export function svelteRouteFor(mod: string): string | null {
	const kind = svelteModKind(mod)
	if (kind === null || kind === 'wrapper' || kind === 'error') return null
	if (kind === 'page') {
		const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
		return dir === '' || dir === 'api' ? '/' : `/${dir}`
	}
	return `/${mod}`
}

/** SSR manifest entry: route → svelte file + data pairing.
 * Engine-agnostic JSON — adapters (ssr-qjs/ssr-bun) consume it; core
 * never imports svelte/compiler, quickjs, or bun. */
export interface SvelteRouteEntry {
	route: string
	svelte: string
	kind: 'page' | 'plain' | 'error' | 'wrapper'
	hasData: boolean
}

function relPosixTop(abs: string, f: string): string {
	return f
		.slice(abs.length + 1)
		.split(sep)
		.join('/')
}

/** Collect `.svelte` siblings under routesAbs into a URL manifest.
 * Dynamic segments pass through verbatim ([id]/[...rest]). */
export function collectSvelteManifest(
	routesAbs: string,
	routesDir: string,
	vMods: Set<string>
): { entries: SvelteRouteEntry[]; hasError: boolean } {
	const entries: SvelteRouteEntry[] = []
	let hasError = false
	let files: string[] = []
	try {
		files = listFilesWithExt(routesAbs, '.svelte')
	} catch {
		return { entries, hasError }
	}
	for (const f of files.sort()) {
		const rel = relPosixTop(routesAbs, f)
		const mod = rel.replace(/\.svelte$/, '')
		const kind = svelteModKind(mod)
		if (kind === null) continue
		if (kind === 'error') {
			const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
			if (dir !== '') {
				throw new Error(
					`[swelte] ${routesDir}/${rel} is not allowed — only src/routes/+error.svelte exists (single global error boundary, no per-directory inheritance).`
				)
			}
			hasError = true
			entries.push({ route: '/+error', svelte: rel, kind: 'error', hasData: false })
			continue
		}
		if (kind === 'wrapper') {
			entries.push({
				route: svelteRouteFor(mod) ?? `/${mod}`,
				svelte: rel,
				kind: 'wrapper',
				hasData: vMods.has(mod),
			})
			continue
		}
		const route = svelteRouteFor(mod)
		if (route === null) continue
		// Static .svelte sibling (no .v) must carry no @[...] attrs:
		// it ships zero JS either way (pure static HTML/JS, no data channel).
		if (!vMods.has(mod)) {
			let src = ''
			try {
				src = readFileSync(f, 'utf8')
			} catch {
				src = ''
			}
			const badAttr = /@\[(get|post|put|delete|patch|rpc|sse|before|after)\b/.exec(src)
			if (badAttr) {
				throw new Error(
					`[swelte] ${routesDir}/${rel}: @[${badAttr[1]}] on a .svelte file with no .v partner does nothing — add ${routesDir}/${mod}.v or remove the attribute.`
				)
			}
		}
		entries.push({
			route,
			svelte: rel,
			kind: kind as 'page' | 'plain',
			hasData: vMods.has(mod),
		})
	}
	return { entries, hasError }
}

export function modulePath(root: string, file: string): string {
	return relative(root, file).replace(/\.v$/, '').split(sep).join('/')
}

/** V dispatch prefix for a route mod (`admin/+page` → `swelte_admin__page_`). */
export function vPrefix(mod: string): string {
	return 'swelte_' + mod.replace(/[^A-Za-z0-9_]/g, '_') + '_'
}

/** Filesystem-safe generated name for a route mod (`+page` → `_page`). */
export function vFileSafe(mod: string): string {
	return mod.replace(/[^A-Za-z0-9_]/g, '_')
}

/** Map a routes file to its URL path (spec v-imports.md §2).
 * Dynamic segments pass through verbatim (`users/[id]` →
 * `/users/[id]`); the V dispatcher matches them segment-wise
 * (roadmap §8). `+route` → null (wrapper-only; handled above by callers).
 * Pure + exported: single source for `generate()`'s load path and tests.
 * `[...rest]` at the END of a path is a valid catch-all; `files/[...rest].v`
 * (whole leaf is the catch-all) is malformed in V codegen and throws. */
export function routeFor(routesDir: string, routesAbs: string, file: string): string | null {
	const mod = modulePath(routesAbs, file)
	if (mod === '+route' || mod.endsWith('/+route')) {
		if (mod.includes('['))
			throw new Error(
				`[swelte] ${routesDir}/${relPosix(routesAbs, file)}: dynamic wrapper dirs are not supported (no brackets in +route.v paths)`
			)
		return null
	}
	const leaf = mod === 'index' || mod.endsWith('/index') || mod === '+page' || mod.endsWith('/+page')
	if (leaf) {
		// Folder-root leaf: strip the leaf segment (`+page` or legacy
		// `index`) to get the directory, whose path is the URL.
		// `+page` → `/`, `admin/+page` → `/admin`.
		// NOTE: `+page.v` sorting — `+` (0x2B) sorts before letters,
		// so `+page.v` may scan before `admin/`. Sort order of
		// listVFiles is deterministic; route identity never depends
		// on it (pure function of mod).
		const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
		if (dir !== '')
			validateDynamicSegs(`${routesDir}/${relPosix(routesAbs, file)}`, dir.split('/'))
		return dir === '' || dir === 'api' ? '/' : `/${dir}`
	}
	const segs = mod.split('/')
	const restIdx = segs.findIndex((s) => /^\[\.\.\..+\]$/.test(s))
	if (restIdx >= 0 && restIdx === segs.length - 1 && segs.length > 1 && /^\[\.\.\.[A-Za-z_][A-Za-z0-9_]*\]$/.test(segs[restIdx])) {
		// `[...rest]`-as-whole-leaf: `files/[...rest].v` — the dispatcher
		// treats a bare catch-all leaf as malformed (no static head).
		throw new Error(
			`[swelte] ${routesDir}/${relPosix(routesAbs, file)}: malformed route (bare [...rest] leaf — put the catch-all under a named dir)`
		)
	}
	validateDynamicSegs(`${routesDir}/${relPosix(routesAbs, file)}`, segs)
	return `/${mod}`
}

export function validateDynamicSegs(file: string, segs: string[]): void {
	const seen = new Set<string>()
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i]
		if (!s.includes('[') && !s.includes(']')) continue
		const single = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(s)
		const rest = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(s)
		if (single) {
			if (seen.has(single[1]))
				throw new Error(`[swelte] ${file}: duplicate route param [${single[1]}]`)
			seen.add(single[1])
			continue
		}
		if (rest) {
			if (i !== segs.length - 1)
				throw new Error(`[swelte] ${file}: [...${rest[1]}] catch-all must be the last segment`)
			if (seen.has(rest[1]))
				throw new Error(`[swelte] ${file}: duplicate route param [...${rest[1]}]`)
			seen.add(rest[1])
			continue
		}
		throw new Error(`[swelte] ${file}: bad dynamic segment '${s}' (want [id] or [...rest])`)
	}
}

export function relPosix(abs: string, f: string): string {
	return relative(abs, f).split(sep).join('/')
}

/** V → TS projection (single place both `parseVFile` and `parseStructs` use). */
export function tsTypeFor(vType: string): string {
	const t = vType.trim()
	if (t === 'SwelteRequest') return 'SwelteRequest'
	if (/^string$/.test(t)) return 'string'
	if (/^(bool)$/.test(t)) return 'boolean'
	if (
		/^(int|i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|f32|f64|float|fsize|byte|rune|time\.Duration)$/.test(
			t
		)
	)
		return 'number'
	if (/^time\.Time$/.test(t)) return 'number'
	if (t.startsWith('[]')) {
		if (/^\[\]u8$/.test(t)) return 'string'
		return `${tsTypeFor(t.slice(2))}[]`
	}
	if (t.startsWith('map[')) return 'Record<string, unknown>'
	if (t === 'json.Any' || t === 'json2.Any') return 'unknown'
	if (/^\?/.test(t)) {
		const inner = tsTypeFor(t.slice(1))
		return inner === 'unknown' ? 'unknown' : `${inner} | null`
	}
	if (/^!/.test(t)) return tsTypeFor(t.slice(1))
	if (t === '' || t === 'void') return 'void'
	// Named V type (struct/enum/alias): project 1:1 to a TS interface with
	// the same name. Struct bodies are emitted by parseStructs below; types
	// not found in the same file stay as-is and resolve via imports later.
	if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t)) return t.split('.').pop() as string
	return 'unknown'
}

export interface VStruct {
	name: string
	fields: { name: string; vtype: string; tstype: string; optional: boolean }[]
}

export function parseStructs(src: string): VStruct[] {
	const out: VStruct[] = []
	const re = /pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g
	let m: RegExpExecArray | null
	while ((m = re.exec(src)) !== null) {
		const name = m[1]
		const body = m[2]
		const fields: VStruct['fields'] = []
		for (const raw of body.split('\n')) {
			const line = raw.trim()
			if (
				!line ||
				line.startsWith('//') ||
				line.startsWith('pub:') ||
				line.startsWith('mut:') ||
				line === 'pub' ||
				line === 'mut'
			)
				continue
			const fm =
				/^([A-Za-z_][A-Za-z0-9_]*)\s+([?!]?[A-Za-z0-9_.[\]]+)(?:\s*=.*|\s+@[a-z_]+\s*.*)?$/.exec(
					line
				)
			if (!fm) continue
			const vtype = fm[2].trim()
			fields.push({ name: fm[1], vtype, tstype: tsTypeFor(vtype), optional: /^\?/.test(vtype) })
		}
		out.push({ name, fields })
	}
	return out
}

/** Dynamic path params of a route pattern (`users/[id]` -> ['id']). */
export function routeParams(route: string): string[] {
	const out: string[] = []
	for (const m of route.matchAll(
		/\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]|\[([A-Za-z_][A-Za-z0-9_]*)\]/g
	))
		out.push(m[1] ?? m[2])
	return out
}

/** Narrow-args binding (roadmap section 8): verb fns not taking SwelteRequest
 * resolve each param by name from form-query-params (all strings on the
 * wire) and coerce to the V param type: ints via .int(), floats via .f64(),
 * bools via == true-string. `?T` optionals CANNOT inline `none` in a call
 * arg on V 0.5.2 (C backend emits `void[]`, cc rejects) — the call-site
 * builder below hoists them into `mut swelte_opt_N := ?T(none)` temps.
 * Returns per-param { raw, expr, optType }: raw is the string lookup, expr
 * the coerced value expression, optType the `?T` when optional. */
export function narrowArgParts(p: { name: string; vtype: string }): {
	raw: string
	expr: string
	optType: string | null
} {
	const raw = `req.form['${p.name}'] or { req.query['${p.name}'] or { req.params['${p.name}'] or { '' } } }`
	const t = p.vtype.trim()
	if (t.startsWith('?')) {
		const inner = narrowArgParts({ name: p.name, vtype: t.slice(1) })
		return { raw, expr: inner.expr, optType: t }
	}
	if (/^(int|i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|byte|rune)$/.test(t))
		return { raw, expr: '(' + raw + ').int()', optType: null }
	if (/^(f32|f64|float|fsize)$/.test(t)) return { raw, expr: '(' + raw + ').f64()', optType: null }
	if (/^bool$/.test(t)) return { raw, expr: '(' + raw + ") == 'true'", optType: null }
	return { raw, expr: raw, optType: null }
}

/** Build a narrow-args call: `stmts` hoists `?T` temps (V 0.5.2 needs
 * `mut v_N := ?T(none)` + conditional assign — inline `none` in an arg
 * miscompiles), `call` is the `fn(a0, a1, ...)` expression. */
export function narrowCall(
	fnName: string,
	params: { name: string; vtype: string }[]
): {
	stmts: string[]
	call: string
} {
	const stmts: string[] = []
	const args = params.map((p, i) => {
		const part = narrowArgParts(p)
		if (part.optType === null) return part.expr
		const tmp = `swelte_opt_${i}`
		stmts.push(`mut ${tmp} := ${part.optType}(none)`)
		stmts.push(`if ${part.raw} != '' { ${tmp} = ${part.expr} }`)
		return tmp
	})
	return { stmts, call: `${fnName}(${args.join(', ')})` }
}

function pascal(s: string): string {
	return s
		.split('_')
		.map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
		.join('')
}

export function swelte(options: SweltePluginOptions = {}): Plugin {
	let routesDir = options.routesDir ?? 'src/routes'
	let libDir = options.libDir ?? 'src/lib'
	let outDir = options.outDir ?? '.swelte'
	// Resolved per-generate() against the Vite root (never at construction:
	// outDir is relative and the cwd at plugin-construction time is not the
	// project root when loaded via vite.config.ts).
	const devWasmDirFor = (root: string) => join(resolve(root, outDir), 'dev')
	const prodWasmName = 'app_lib.wasm'
	let activeRoot = ''
	let isBuild = false
	// Serialize generate(): configResolved fires a void generate() while
	// buildStart runs another — concurrent runs interleave file writes
	// (stale routes.js wins the race). Chain on the in-flight promise.
	let genChain: Promise<void> = Promise.resolve()
	// Roadmap §6 tree-shaking: every .v import resolved through the plugin
	// is recorded here (abs path → same). generateBundle compiles only the
	// recorded client-used #lib/ files — untouched helpers never enter
	// the prod wasm. Reset per build (buildStart) so dev/test resolutions
	// never leak into a bundle.
	const usedLibFiles = new Set<string>()
	const vBackendUrl =
		options.vBackendUrl ?? process.env.SWELTE_V_BACKEND_URL ?? process.env.VITE_SWELTE_V_BACKEND_URL
	function serverRoot(): string {
		return activeRoot
	}

	/** Portable subset for `v -b wasm -os browser` (V 0.5.2). V's `json`
	 * module is C-backed and the wasm backend chokes on `strings`/`math`
	 * (array `.len` lowering) and `crypto/*` (transitive `io` import).
	 * `#lib/backend/` is exempt (never compiled to WASM). */
	const WASM_LIB_ALLOW = new Set(['math', 'strings', 'encoding', 'crypto', 'json', 'json2'])
	const WASM_KNOWN_BROKEN = new Set(['strings', 'math', 'crypto', 'json'])

	function wasmBlockedImports(src: string): string[] {
		const blocked: string[] = []
		for (const m of src.matchAll(/^\s*import\s+([^\n;]+)/gm)) {
			for (const part of m[1].split(',')) {
				const p = part.trim().replace(/^\(/, '').replace(/\)$/, '').trim()
				if (!p || p.startsWith('//')) continue
				const mod = p.split(/\s+/).pop() as string
				const top = mod.split('.')[0]
				if (top === 'main' || top === 'builtin' || top === '') continue
				if (
					top === 'os' ||
					top === 'net' ||
					top === 'db' ||
					top === 'time' ||
					top === 'v' ||
					top === 'wasm' ||
					top === 'x'
				) {
					blocked.push(mod)
					continue
				}
				if (!WASM_LIB_ALLOW.has(top) && !WASM_LIB_ALLOW.has(mod)) blocked.push(mod)
			}
		}
		return [...new Set(blocked)]
	}

	function wasmParamKind(vtype: string): string | null {
		const t = vtype.trim().replace(/^\?/, '')
		if (t === 'string') return 'string'
		if (t === 'bool') return 'bool'
		if (
			t === 'int' ||
			t === 'i8' ||
			t === 'i16' ||
			t === 'i32' ||
			t === 'u8' ||
			t === 'u16' ||
			t === 'u32' ||
			t === 'rune' ||
			t === 'char'
		)
			return 'int'
		return null
	}

	function wasmReturnKind(vtype: string): string | null {
		const t = vtype.trim()
		if (t === '' || t === 'void') return 'void'
		if (t === 'string') return 'string'
		if (t === 'bool') return 'bool'
		if (
			t === 'int' ||
			t === 'i8' ||
			t === 'i16' ||
			t === 'i32' ||
			t === 'u8' ||
			t === 'u16' ||
			t === 'u32' ||
			t === 'rune' ||
			t === 'char'
		)
			return 'int'
		return null
	}

	function compileLibWasm(src: string, mod: string, outWasm: string, libRel: string): number {
		const fns = parseVFile(src).filter((x) => x.attr === 'rpc')
		for (const f of fns) {
			for (const p of f.params) {
				if (wasmParamKind(p.vtype) === null) {
					throw new Error(
						libRel +
							': ' +
							f.name +
							'(' +
							p.name +
							': ' +
							p.vtype +
							') cannot cross the WASM boundary'
					)
				}
			}
			if (f.fallible)
				throw new Error(
					libRel +
						': ' +
						f.name +
						' is fallible — the V wasm backend cannot compile !T/?T (compiler ICE)'
				)
			if (wasmReturnKind(f.vret) === null)
				throw new Error(libRel + ': ' + f.name + ' returns ' + (f.vret || '(unparsed)'))
		}
		const blocked = wasmBlockedImports(src)
		if (blocked.length > 0) throw new Error(libRel + ': blocked import(s): ' + blocked.join(', '))
		const broken = [
			...new Set(
				[...src.matchAll(/^\s*import\s+([^\n;]+)/gm)]
					.flatMap((m) => m[1].split(','))
					.map((p) => p.trim().split(/\s+/).pop() as string)
					.map((mm) => mm.split('.')[0])
					.filter((top) => WASM_KNOWN_BROKEN.has(top))
			),
		]
		if (broken.length > 0)
			throw new Error(
				libRel +
					': uses known-broken wasm stdlib (' +
					broken.join(', ') +
					') — V 0.5.2 backend limitation'
			)
		const body = src
			.replace(/^\s*module\s+\S+.*$/m, 'module main')
			.replace(/@\[([^\]]*)\]\s*/g, (_mm, attrs: string) => {
				const keep = attrs
					.split(';')
					.map((a: string) => a.trim())
					.filter((a: string) => a && !/^(rpc|get|post|put|delete|patch|sse)\b/.test(a))
				return keep.length > 0 ? '@[' + keep.join('; ') + '] ' : ''
			})
		const compiled = [
			`module main

@[export: 'swelte_alloc']
pub fn swelte_alloc(n int) &u8 {
	return unsafe { malloc(if n <= 0 { 1 } else { n }) }
}
`,
			...body.split('\n').filter((l) => !/^\s*module\s+\S+/.test(l)),
		].join('\n')
		mkdirSync(dirname(outWasm), { recursive: true })
		const tmp = join(dirname(outWasm), '.compile.v')
		writeFileSync(tmp, compiled)
		try {
			if (!vBin) vBin = resolveV(import.meta.url)
			execVSync(vBin, ['-b', 'wasm', '-os', 'browser', '-o', outWasm, tmp], {
				stdio: ['ignore', 'pipe', 'pipe'],
				env: toolchainEnv(),
			})
			const size = statSync(outWasm).size
			return size
		} finally {
			try {
				rmSync(tmp, { force: true })
			} catch {
				/* ignore */
			}
		}
	}

	/* Folder-root double-claim, unconditional (roadmap 7):
	 * sibling foo.v/foo.svelte vs folder-root leaf foo/+page.* /
	 * foo/index.* claim the same URL - build error, naming both.
	 * One file per URL, so guarded URLs live inside their guard's
	 * directory. Either extension counts on EITHER side: a .v-less
	 * foo.svelte still owns the URL and collides with a foo/+page.v
	 * leaf. +route.v/+route.svelte wrap, they don't compete, so they
	 * never enter the check (no double-claim between sibling foo.v
	 * and child foo/+route.v; +route covers foo/** plus the foo/+page
	 * leaf - never the sibling). foo/+router.v (roadmap 8, not built)
	 * will own foo/** - never foo itself - so it never collides.
	 * SSR: .svelte siblings participate via the same
	 * rule — foo.svelte vs foo/+page.v collide on either extension.
	 * Hoisted: `routeFor`, `validateDynamicSegs`, `relPosix` now live as
	 * single exported sources above (shared with tests/load path). */
	/* (closure copies removed) */
	function doubleClaimCheck(routesAbs: string, routesDir: string, mod: string, rel: string): void {
		const dirOf = (m: string) => (m.includes('/') ? m.slice(0, m.lastIndexOf('/')) : '')
		const baseOf = (m: string) => (m.includes('/') ? m.slice(m.lastIndexOf('/') + 1) : m)
		const d = dirOf(mod)
		const b = baseOf(mod)
		const inDir = (bm: string) => (d === '' ? bm : `${d}/${bm}`)
		const pairs: string[][] = []
		if (b === 'index' || b === '+page') {
			const other = b === 'index' ? '+page' : 'index'
			pairs.push([inDir(other) + '.v', inDir(other) + '.svelte'])
			if (d !== '') pairs.push([d + '.v', d + '.svelte'])
		} else {
			pairs.push([inDir('index') + '.v', inDir('index') + '.svelte'])
			pairs.push([inDir('+page') + '.v', inDir('+page') + '.svelte'])
		}
		const others: string[] = []
		const selfV = mod + '.v'
		const selfSvelte = mod + '.svelte'
		for (const pr of pairs) {
			const v = pr[0]
			const st = pr[1]
			// Either extension on either side counts, unconditionally:
			// a `.v`-less `foo.svelte` still owns the URL and collides
			// with a `foo/+page.v` leaf. Exclude only self's own files.
			if (v !== selfV && existsSync(join(routesAbs, v))) others.push(routesDir + '/' + v)
			if (
				routesDir + '/' + st !== routesDir + '/' + selfSvelte &&
				existsSync(join(routesAbs, st))
			) {
				others.push(routesDir + '/' + st)
			}
		}
		if (others.length > 0) {
			throw new Error(
				`[swelte] ${routesDir}/${rel} claims the same URL as ${others.join(' + ')} — one file per URL (guarded URLs live inside their guard's directory; keep the +page leaf).`
			)
		}
	}

	/** Middleware shapes (§7). */
	function validateMiddlewareFn(rel: string, m: RpcFn): void {
		if (m.qualifier)
			throw new Error(
				`[swelte] ${rel}: @[${m.attr}] ${m.name} takes no qualifier (wrappers run for the whole subtree, not one ?q).`
			)
		if (m.attr === 'before') {
			if (m.params.length !== 1 || m.params[0].vtype !== 'SwelteRequest')
				throw new Error(
					`[swelte] ${rel}: @[before] ${m.name} must take exactly one SwelteRequest param.`
				)
			if (m.vret !== 'SwelteRequest' || !m.fallible)
				throw new Error(`[swelte] ${rel}: @[before] ${m.name} must return !SwelteRequest.`)
		} else {
			const pv = m.params.map((pp) => pp.vtype)
			if (pv.length !== 3 || pv[0] !== 'SwelteRequest' || pv[1] !== 'int' || pv[2] !== 'string')
				throw new Error(
					`[swelte] ${rel}: @[after] ${m.name} must take (SwelteRequest, int, string).`
				)
			if (!/^\(\s*int\s*,\s*string\s*\)$/.test(m.vret) || !m.fallible)
				throw new Error(
					`[swelte] ${rel}: @[after] ${m.name} must return !(int, string) (got ${m.fallible ? '!' : ''}${m.vret || 'none'}).`
				)
		}
	}

	/** Loader shape: `@[load] name(req SwelteRequest[, parent T]) !R`.
	 * Level 0 (no ancestor load): exactly one param (SwelteRequest).
	 * Deeper levels: `(SwelteRequest, parent T)` where T is the previous
	 * level's return struct (prefixed name, same merged file — no import).
	 * Mismatch → build error (the layout contract, enforced).
	 * Returns the page-data value for this level — any JSON-able V value.
	 * No qualifier (loaders run for the whole page, not one ?q).
	 * Throw → +error props. */
	function validateLoadFn(rel: string, m: RpcFn, parentRet: string | null): void {
		if (m.qualifier)
			throw new Error(
				`[swelte] ${rel}: @[load] ${m.name} takes no qualifier (loaders run for the whole page, not one ?q).`
			)
		if (m.vret === '' || m.vret === 'unknown')
			throw new Error(`[swelte] ${rel}: @[load] ${m.name} must return a value (the level's page data).`)
		if (parentRet === null) {
			if (m.params.length !== 1 || m.params[0].vtype !== 'SwelteRequest')
				throw new Error(
					`[swelte] ${rel}: @[load] ${m.name} is the first loader — it takes exactly one SwelteRequest param (no parent at root).`
				)
			return
		}
		if (m.params.length !== 2 || m.params[0].vtype !== 'SwelteRequest')
			throw new Error(
				`[swelte] ${rel}: @[load] ${m.name} must take (SwelteRequest, parent ${parentRet}) — parent is the previous level's value, already built.`
			)
		const got = m.params[1].vtype
		// Ancestor return may be written short (AdminLayout) or vType-
		// prefixed (AdminRoute_AdminLayout) — codegen merges both into one
		// file. Accept either spelling; the cascade calls under owning prefixes.
		const short = parentRet.includes('_') ? parentRet.split('_').pop()! : parentRet
		if (got !== parentRet && got !== short)
			throw new Error(
				`[swelte] ${rel}: @[load] ${m.name} parent is ${got}, want ${parentRet} (previous level's return — typed, already built).`
			)
	}

	interface WrapperMw {
		wmod: string
		src: string
		mws: { name: string; attr: 'before' | 'after' }[]
	}

	/** Ancestor dirs root-first for a leaf URL dir (§7). */
	function ancestorDirs(leafDir: string): string[] {
		const segs = leafDir === '' ? [] : leafDir.split('/')
		const dirs: string[] = ['']
		for (let i = 0; i < segs.length; i++) dirs.push(segs.slice(0, i + 1).join('/'))
		return dirs
	}

	/** URL dir of a leaf mod (`admin/users` for the file serving /admin/users). */
	function leafDirOf(m: string): string {
		if (m === 'index' || m === '+page') return ''
		if (m.endsWith('/index')) return m.slice(0, -'/index'.length)
		if (m.endsWith('/+page')) return m.slice(0, -'/+page'.length)
		return m.includes('/') ? m.slice(0, m.lastIndexOf('/')) : ''
	}

	/** Validate dynamic segments (`[id]`, `[...rest]`) in a route file path.
	 * Hoisted: single exported `validateDynamicSegs` above.
	 * Throws a build error naming the file on malformed brackets, a
	 * non-final catch-all, or a duplicate param name. */
	/* (closure copy removed) */

	/** Map a routes file to its URL path (spec v-imports.md §2).
	 * Dynamic segments pass through verbatim (`users/[id]` →
	 * `/users/[id]`); the V dispatcher matches them segment-wise
	 * (roadmap §8). */
	/* hoisted: single exported `routeFor` above (kills the closure copy). */

	function vJsonStr(s: string): string {
		return JSON.stringify(s)
	}

	function vType(base: string, mod: string): string {
		const cap = mod
			.replace(/[^A-Za-z0-9_]/g, '_')
			.split('_')
			.filter(Boolean)
			.map((s) => s[0].toUpperCase() + s.slice(1))
			.join('')
		return `${cap}_${base}`
	}

	/** §7: inline wrapper middleware fn sources into the leaf file
	 * (module routes, V needs one file: prefix by owning wrapper mod).
	 * Only middleware fns: skip structs — the leaf struct pass handles
	 * declarations; references resolve via vType. */
	function inlineWrapperFns(src: string, wmod: string, structNames: Set<string>): string[] {
		const wprefix = vPrefix(wmod)
		const out: string[] = []
		const lines = src.split('\n')
		let depth = 0
		let keep = false
		let buf: string[] = []
		const flush = () => {
			if (keep && buf.length > 0) {
				const hi = buf.findIndex((b) => /^(\s*)pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/.test(b))
				const fm = /^(\s*)pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(buf[hi < 0 ? 0 : hi] ?? '')
				if (fm) {
					buf[hi < 0 ? 0 : hi] =
						`${fm[1]}pub fn ${wprefix}${fm[2]}${(buf[hi < 0 ? 0 : hi]).slice(fm[0].length)}`
					for (let i = 0; i < buf.length; i++) {
						if (i === 0) {
							const t0 = buf[0].trim()
							if (/^(pub\s+)?struct\s/.test(t0)) continue
						}
						for (const sn of structNames) {
							buf[i] = buf[i].split(sn).join(vType(sn, wmod))
						}
					}
					for (const l of buf) out.push(l)
				}
			}
			buf = []
			keep = false
		}
		for (const line of lines) {
			const t = line.trim()
			if (depth === 0) {
				if (/^module\s+\S+/.test(t)) continue
				if (/^\s*import\s+/.test(line)) continue
				const fnHere = /^\s*(pub\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
				const attrHere = /@\[[^\]]*(before|after|load)/.test(line)
				const bareAttr = /^\s*@\[/.test(line) && !fnHere
				if (bareAttr) {
					buf.push(line)
					continue
				}
				if (fnHere) {
					keep = attrHere || buf.some((b) => /@\[[^\]]*(before|after|load)/.test(b))
					buf.push(line)
					depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
					if (depth <= 0) {
						depth = 0
						flush()
					}
					continue
				}
				if (/^\s*@\[/.test(line)) {
					buf.push(line)
					continue
				}
				if (/^\s*(pub\s+)?struct\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(line)) {
					depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
					continue
				}
				continue
			}
			buf.push(line)
			depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
			if (depth <= 0) {
				depth = 0
				flush()
			}
		}
		flush()
		return out
	}

	function emitServerGen(
		dispatched: { route: string; mod: string; prefix: string }[],
		sseMods: Set<string> = new Set()
	): string {
		/** Dynamic route arms (section 8): static beats dynamic; among dynamics,
		 * fewer [segs] first, [...rest] catch-all last (stable sort). */
		function dynSorted() {
			return dispatched
				.filter((x) => x.route.includes('['))
				.sort((a, b) => {
					const ca = a.route.includes('[...') ? 1 : 0
					const cb = b.route.includes('[...') ? 1 : 0
					if (ca !== cb) return ca - cb
					const pa = (a.route.match(/\[/g) || []).length
					const pb = (b.route.match(/\[/g) || []).length
					if (pa !== pb) return pa - pb
					return a.route < b.route ? -1 : a.route > b.route ? 1 : 0
				})
		}

		const o: string[] = [
			`// Auto-generated by swelte from V signatures. Do not edit.
module routes

import json
import net.urllib

fn swelte_unescape(s string) string {
	return urllib.path_unescape(s) or { s }
}

fn swelte_forbidden() (int, string, []string) {
	return 403, '{"error":"forbidden"}', []string{}
}

fn swelte_method_not_allowed() (int, string, []string) {
	return 405, '{"error":"method not allowed"}', []string{}
}

fn swelte_method_gate(method string) (int, string, []string) {
	if method == 'POST' || method == 'PUT' || method == 'PATCH' || method == 'DELETE' { return swelte_forbidden() }
	return swelte_method_not_allowed()
}

fn swelte_normalize_path(path string) string {
	if path.len > 1 && path.ends_with('/') { return path[..path.len - 1] }
	return path
}
`,
		`
pub struct SwelteRequest {
pub mut:
	query map[string]string
	form map[string]string
	files map[string]string
	headers map[string]string
	cookies map[string]string
	params map[string]string
	method string
	path string
	qualifier string
}

fn swelte_err_unknown(path string, fn_name string, available []string) (int, string, []string) {
	mut avail := '['
	for i, a in available {
		if i > 0 { avail += ',' }
		avail += json.encode(a)
	}
	avail += ']'
	return 404, '{"error":"unknown fn","fn":' + json.encode(fn_name) + ',"path":' + json.encode(path) + ',"available":' + avail + '}', []string{}
}

fn swelte_err_unknown_cookies(path string, fn_name string, available []string) (int, string, []string) {
	return swelte_err_unknown(path, fn_name, available)
}

fn swelte_err_bad(path string, fn_name string, detail string) (int, string, []string) {
	return 400, '{"error":' + json.encode(detail) + ',"fn":' + json.encode(fn_name) + ',"path":' + json.encode(path) + '}', []string{}
}

fn swelte_err_bad_cookies(path string, fn_name string, detail string) (int, string, []string) {
	return swelte_err_bad(path, fn_name, detail)
}

fn swelte_err_unknown_qual(path string, available []string) (int, string, []string) {
	mut avail := '['
	for i, a in available {
		if i > 0 { avail += ',' }
		avail += json.encode(a)
	}
	avail += ']'
	return 404, '{"error":"unknown qualifier","path":' + json.encode(path) + ',"available":' + avail + '}', []string{}
}

fn swelte_err_unknown_qual_cookies(path string, available []string) (int, string, []string) {
	return swelte_err_unknown_qual(path, available)
}

fn swelte_match_route(pattern string, path string) (bool, map[string]string) {
	norm_path := swelte_normalize_path(path)
	mut params := map[string]string{}
	if pattern == '/' { if norm_path == '/' || norm_path == '' { return true, params } return false, params }
	mut psegs := pattern.split("/")
	mut segs := norm_path.split("/")
	if psegs.len > 0 && psegs[0] == '' { psegs.delete(0) }
	if segs.len > 0 && segs[0] == '' { segs.delete(0) }
	if psegs.len > 0 && psegs.last().starts_with('[...') {
		name := psegs.last()[4..psegs.last().len - 1]
		if segs.len < psegs.len - 1 { return false, params }
		for i in 0 .. psegs.len - 1 {
			ps := psegs[i]
			if ps.starts_with('[') { params[ps[1..ps.len - 1]] = if i < segs.len { swelte_unescape(segs[i]) } else { '' } } else if i >= segs.len || ps != segs[i] { return false, params }
		}
		mut rest_parts := segs[psegs.len - 1..].clone()
		for ri, rp in rest_parts { rest_parts[ri] = swelte_unescape(rp) }
		params[name] = rest_parts.join("/")
		return true, params
	}
	if psegs.len != segs.len { return false, params }
	for i in 0 .. psegs.len {
		ps := psegs[i]
		if ps.starts_with('[') { if segs[i] == '' { return false, params } params[ps[1..ps.len - 1]] = swelte_unescape(segs[i]) } else if ps != segs[i] { return false, params }
	}
	return true, params
}

pub fn swelte_route(path string, method string, query map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string) (int, string, []string) {
	norm_path := swelte_normalize_path(path)`,
			...dispatched
				.filter((x) => !x.route.includes('['))
				.map(
					(d) =>
						`\tif norm_path == ${vJsonStr(d.route)} { return ${d.prefix}dispatch(norm_path, method, query, map[string]string{}, headers, cookies, body, content_type, qualifier) }`
				),
			// Dynamic arms (section 8) after exact arms: static beats dynamic; among
			// dynamics, fewer [segs] first, [...rest] catch-all last (stable sort).
			...dynSorted().map(
				(d) =>
					`\t${d.prefix}matched, ${d.prefix}params := swelte_match_route(${vJsonStr(d.route)}, norm_path)
	if ${d.prefix}matched { return ${d.prefix}dispatch(norm_path, method, query, ${d.prefix}params, headers, cookies, body, content_type, qualifier) }`
			),
			`\treturn 404, '{"error":"not found"}', []string{}
}
`,
			// SSE route predicate (§14, true streaming via veb).
			// `before_request` (which owns `ctx`) calls this FIRST: on a
			// GET+Accept match on an SSE route it takes over + streams and
			// never reaches dispatch. Returns the dispatch prefix for the
			// matched file (whose `sse_events` accessor yields the list),
			// or '' when this request is not an SSE stream.
			`pub fn swelte_sse_route(path string, method string, query map[string]string, headers map[string]string, qualifier string) (string, map[string]string) {
	mut accept := headers['Accept'] or { headers['accept'] or { '' } }
	if method != 'GET' || !accept.contains('text/event-stream') { return '', map[string]string{} }
	norm_path := swelte_normalize_path(path)`,
			...dispatched
				.filter((x) => !x.route.includes('['))
				.filter((d) => sseMods.has(d.mod))
				.map(
					(d) =>
						`\tif norm_path == ${vJsonStr(d.route)} { return ${vJsonStr(d.prefix)}, map[string]string{} }`
				),
			...dynSorted()
				.filter((d) => sseMods.has(d.mod))
				.map(
					(d) =>
						`\t${d.prefix}matched, ${d.prefix}params := swelte_match_route(${vJsonStr(d.route)}, norm_path)
	if ${d.prefix}matched { return ${vJsonStr(d.prefix)}, ${d.prefix}params }`
				),
			`\treturn '', map[string]string{}
}
`,
			// SSE events fan-out (§14): `before_request` resolves the route
			// to a dispatch prefix; this maps prefix → per-file accessor.
			// List mode returns the list; emit mode runs the fn with the
			// harness emitter. Qualifier pre-check is side-effect free
			// (emit fns run ONLY inside the writer, post-takeover).
			`pub fn swelte_sse_events_for(prefix string, qualifier string, req SwelteRequest) ![]string {`,
			...dispatched
				.filter((d) => sseMods.has(d.mod))
				.map(
					(d) =>
						`\tif prefix == ${vJsonStr(d.prefix)} { return ${d.prefix}sse_events(qualifier, req) }`
				),
			`\treturn error('no sse route for prefix: ' + prefix)
}

pub fn swelte_sse_is_emit(prefix string) bool {`,
			...dispatched
				.filter((d) => sseMods.has(d.mod))
				.map((d) => `\tif prefix == ${vJsonStr(d.prefix)} { return ${d.prefix}sse_is_emit() }`),
			`\treturn false
}

pub fn swelte_sse_check_qual(prefix string, qualifier string) ! {`,
			...dispatched
				.filter((d) => sseMods.has(d.mod))
				.map(
					(d) =>
						`\tif prefix == ${vJsonStr(d.prefix)} { ${d.prefix}sse_check_qual(qualifier) or { return err } return }`
				),
			`\treturn error('no sse route for prefix: ' + prefix)
}

pub fn swelte_sse_emit_for(prefix string, qualifier string, req SwelteRequest, emit fn (string) bool) ! {`,
			...dispatched
				.filter((d) => sseMods.has(d.mod))
				.map(
					(d) =>
						`\tif prefix == ${vJsonStr(d.prefix)} { ${d.prefix}sse_emit(qualifier, req, emit) or { return err } return }`
				),
			`\treturn error('no sse route for prefix: ' + prefix)
}
`,
			// Loader fan-out: `before_request` resolves the page route to a
			// dispatch prefix; this maps prefix → per-file `swelte_load`.
			// Any throw → error (caller maps to +error props). No loads
			// on the file → its `swelte_load` returns '{}'.
			`pub fn swelte_load_for(prefix string, req SwelteRequest) !string {`,
			...dispatched.map(
				(d) => `\tif prefix == ${vJsonStr(d.prefix)} { return ${d.prefix}swelte_load(req) }`
			),
			`\treturn error('no load route for prefix: ' + prefix)
}
`,
			// Page-route resolver for the load path: path → (prefix, params),
			// same precedence as swelte_route (static-first, dynamics sorted).
			// Only non-api routes resolve (api/* never has page data).
			// Miss → ('', {}) so the harness falls back to '{}'/static.
			`pub fn swelte_load_route(path string) (string, map[string]string) {
\tnorm_path := swelte_normalize_path(path)`,
			...dispatched
				.filter((x) => !x.route.includes('[') && !x.route.startsWith('/api/'))
				.map(
					(d) =>
						`\tif norm_path == ${vJsonStr(d.route)} { return ${vJsonStr(d.prefix)}, map[string]string{} }`
				),
			...dynSorted()
				.filter((d) => !d.route.startsWith('/api/'))
				.map(
					(d) =>
						`\t${d.prefix}matched, ${d.prefix}params := swelte_match_route(${vJsonStr(d.route)}, norm_path)
\tif ${d.prefix}matched { return ${vJsonStr(d.prefix)}, ${d.prefix}params }`
				),
			`\treturn '', map[string]string{}
}
`,
		]
		return o.join('\n')
	}

function emitRouteFile(
	mod: string,
	route: string,
	prefix: string,
	src: string,
	fns: RpcFn[],
	chain: WrapperMw[],
	loads: LoadFn[]
): string {
	// Hoisted-source note: `generate()` + `load()` call the single
	// exported `routeFor`/`jsFetchFor`/`jsWasmFor` above (no closure copy).
		const needRpc = fns.some((f) => f.attr === 'rpc')
		const needVerb = fns.some(
			(f) => f.attr !== 'rpc' && f.attr !== 'before' && f.attr !== 'after' && f.attr !== 'load'
		)
		// Only what this file's dispatch branch uses: rpc -> json+json2,
		// verbs -> json+http. Never emit an unused import (V warns).
		const baseImports = [
			'import json',
			...(needRpc ? ['import x.json2'] : []),
			...(needVerb ? ['import net.http'] : []),
			'',
		]
		const seenImp = new Set<string>()
		for (const impsrc of [src, ...chain.map((w) => w.src)]) {
			for (const m of impsrc.matchAll(/^\s*import\s+(.+)$/gm)) {
				const imp = m[1].trim()
				const first = imp.split(/[\s,]/)[0]
				if (
					!imp ||
					first === 'routes' ||
					first === 'json' ||
					first === 'x.json2' ||
					first === 'net.http' ||
					seenImp.has(imp)
				)
					continue
				seenImp.add(imp)
			}
		}
		// §10: per-fn Set-Cookie emitters live in the same `module routes`
		// file as the dispatcher that calls them (V: same-module call).
		// EVERY dispatch success path calls swelte_set_cookies_for_<fn>(),
		// so every rpc/verb fn gets an emitter: flagged fns return the
		// sess cookie template (placeholder replaced by Hand), unflagged
		// fns return []string{}.
		const cookieEmitters = list(
			fns.filter(
				(fn) =>
					fn.attr === 'rpc' || ['get', 'post', 'put', 'delete', 'patch', 'sse'].includes(fn.attr)
			),
			(fn) => `fn swelte_set_cookies_for_${prefix}${fn.name}() []string {
	return ${fn.setsCookie ? `['sess=__SWELTE_SESS__; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800']` : `[]string{}`}
}

`
		)
		// Shared structs: prefix to avoid duplicate-definition collisions
		// when several per-file outputs share `module routes`.
		const structNames = new Set(parseStructs(src).map((s) => s.name))
		for (const w of chain) {
			for (const st of parseStructs(w.src)) structNames.add(st.name)
		}
		const wrapperLines = chain.flatMap((w) => inlineWrapperFns(w.src, w.wmod, structNames))
		// Wrapper struct decls: inlineWrapperFns skips them (fn-only inline),
		// so emit them here under the wrapper's prefixed name. Leaf decls
		// flow through srcLines below; skip any the leaf redefines.
		const leafStructs = new Set(parseStructs(src).map((s) => s.name))
		const wrapperStructDecls = chain.flatMap((w) =>
			parseStructs(w.src)
				.filter((st) => !leafStructs.has(st.name))
				.map(
					(st) =>
						`pub struct ${vType(st.name, w.wmod)} {\npub:\n${st.fields.map((f) => `\t${f.name} ${f.vtype}`).join('\n')}\n}`
				)
		)
		const srcLines = src.split('\n').flatMap((line) => {
			const t = line.trim()
			if (/^module\s+\S+/.test(t)) return []
			if (/^\s*import\s+/.test(line)) return []
			let out = line.replace(/^(\s*)pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/, `$1pub fn ${prefix}$2`)
			out = out.replace(
				/^(\s*)(pub\s+struct\s+)([A-Za-z_][A-Za-z0-9_]*)/,
				(mm: string, sp: string, kw: string, nm: string) =>
					`${sp}${kw}${(structNames as Set<string>).has(nm) ? vType(nm, mod) : prefix + nm}`
			)
			out = out.replace(/^(\s*)struct\s+([A-Za-z_][A-Za-z0-9_]*)/, `$1struct ${prefix}$2`)
			for (const sn of structNames) {
				if (new RegExp(`^\\s*(pub\\s+)?struct\\s+${sn}\\b`).test(t)) continue
				out = out.replace(new RegExp(`\\b${sn}\\b`, 'g'), vType(sn, mod))
			}
			return [out]
		})
		const o: string[] = [
			`// Auto-generated by swelte from V signatures. Do not edit.
// Route: ${route} <- ${mod}.v
module routes
`,
			// Only what this file's dispatch branch uses: rpc -> json+json2,
			// verbs -> json+http. Never emit an unused import (V warns).
			...baseImports,
			...[...seenImp].map((imp) => `import ${imp}`),
			...(seenImp.size ? [''] : []),
			cookieEmitters,
			...wrapperLines,
			...(wrapperStructDecls.length ? ['', ...wrapperStructDecls] : []),
			'',
			...srcLines,
			'',
		]
		// §7: middleware chain for this leaf. No wrappers → the public
		// `dispatch` IS the verb/rpc body (byte-identical to today, via
		// dispatchBody with sharedReq=null). With wrappers → `dispatch`
		// runs @[before] root→leaf on a shared `swelte_req`, calls the
		// inner verbs body, then runs @[after] leaf→root on (code, body).
		const befores = chain.flatMap((w) =>
			w.mws.filter((mw) => mw.attr === 'before').map((mw) => `${vPrefix(w.wmod)}${mw.name}`)
		)
		const afters = chain.flatMap((w) =>
			w.mws.filter((mw) => mw.attr === 'after').map((mw) => `${vPrefix(w.wmod)}${mw.name}`)
		)
		const aftersLeafFirst = [...afters].reverse()
		const beforeCalls = list(befores, (b) => {
			const bn = b.includes('_') ? b.slice(b.lastIndexOf('_') + 1) : b
			return `\tswelte_req = ${b}(swelte_req) or { return swelte_err_bad_cookies(path, '${bn}', err.msg()) }\n`
		})
		const afterCalls = list(aftersLeafFirst, (a) => {
			const an = a.includes('_') ? a.slice(a.lastIndexOf('_') + 1) : a
			return `\tswelte_code, swelte_body = ${a}(swelte_req, swelte_code, swelte_body) or { return swelte_err_bad_cookies(path, '${an}', err.msg()) }\n`
		})
		if (befores.length === 0 && afters.length === 0) {
			return [
				...o,
				`pub fn ${prefix}dispatch(path string, method string, query map[string]string, params map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string) (int, string, []string) {`,
				dispatchBody(prefix, mod, fns, null),
				'',
				emitSseEvents(prefix, mod, fns),
				emitLoadCascade(prefix, loads),
			].join('\n')
		}
		return [
			...o,
			`pub fn ${prefix}dispatch(path string, method string, query map[string]string, params map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string) (int, string, []string) {
	mut form_before := map[string]string{}
	mut files_before := map[string]string{}
	if content_type.contains('multipart/form-data') {
		mut boundary_before := ''
		for part in content_type.split(';') {
			p_before := part.trim_space()
			if p_before.starts_with('boundary=') { boundary_before = p_before.all_after('boundary=').trim('"') }
		}
		mut swelte_raw_before := map[string][]http.FileData{}
		if boundary_before != '' { form_before, swelte_raw_before = http.parse_multipart_form(body, boundary_before) }
		for k, fs in swelte_raw_before {
			mut swelte_names := []string{}
			for f in fs { swelte_names << f.filename }
			files_before[k] = swelte_names.join(';')
		}
	} else if content_type.contains('application/x-www-form-urlencoded') || body != '' {
		form_before = http.parse_form(body)
	}
	mut swelte_req := SwelteRequest{ query: query, form: form_before, files: files_before, headers: headers, cookies: cookies, params: params, method: method, path: path, qualifier: qualifier }`,
			beforeCalls,
			`	mut swelte_cookies := []string{}
	code_before, body_before, verbs_cookies := ${prefix}dispatch_verbs(path, method, query, params, headers, cookies, body, content_type, qualifier, swelte_req)
	swelte_cookies << verbs_cookies
	mut swelte_code := code_before
	mut swelte_body := body_before`,
			afterCalls,
			`\treturn swelte_code, swelte_body, swelte_cookies
}

fn ${prefix}dispatch_verbs(path string, method string, query map[string]string, params map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string, swelte_req SwelteRequest) (int, string, []string) {`,
			// `req` outlives the method arm (assigned per-arm below, read by
			// handler calls): declare once at function scope.
			`\t_ = body
	_ = content_type
	mut req := SwelteRequest{ query: query, form: map[string]string{}, files: map[string]string{}, headers: headers, cookies: cookies, params: params, method: method, path: path, qualifier: qualifier }`,
			dispatchBody(prefix, mod, fns, 'swelte_req'),
			emitSseEvents(prefix, mod, fns),
			emitLoadCascade(prefix, loads),
		].join('\n')
	}

	/** SSE events accessor (§14, true streaming via veb). Per file with
	 * `@[sse]` fns: `swelte_sse_events(qualifier, req)` returns the fn's
	 * event list for the qualifier, or an error for unknown qualifiers /
	 * fallible failures. `before_request` calls this (it owns `ctx`),
	 * then streams via `swelte_serve_sse`. No body, no sentinel. */
	function emitSseEvents(prefix: string, mod: string, fns: RpcFn[]): string {
		const sseFns = fns.filter((f) => f.attr === 'sse')
		if (!sseFns.length) return ''
		const quals = sseFns.filter((h) => h.qualifier).map((h) => vJsonStr(h.qualifier as string))
		const qualErr = `\treturn error('unknown qualifier: ' + qualifier + ' (available: [${quals.join(', ')}])')`
		const isEmitFn = (h: RpcFn): boolean => {
			const emitP = h.params.length > 0 ? h.params[h.params.length - 1] : null
			return emitP !== null && /^fn\s*\(\s*string\s*\)(\s*bool)?$/.test(emitP.vtype.trim())
		}
		const condFor = (h: RpcFn): string =>
			h.qualifier ? `qualifier == ${vJsonStr(h.qualifier)}` : `qualifier == ''`
		const verbCall = (h: RpcFn): { pre: string[]; call: string } => {
			const isReq = h.params.length === 1 && h.params[0].vtype === 'SwelteRequest'
			if (isReq) return { pre: [], call: `${prefix}${h.name}(req)` }
			const built = narrowCall(`${prefix}${h.name}`, h.params)
			return { pre: built.stmts, call: built.call }
		}
		const arm = (body: string, tail: string): string => (body ? `${body}\n${tail}` : tail)
		const eventsArms = list(
			sseFns.filter((h) => !isEmitFn(h)),
			(h) => {
				const vc = verbCall(h)
				const pre = vc.pre.map((st) => `\t\t${st}`).join('\n')
				const ret = h.fallible ? `\t\treturn ${vc.call} or { return err }` : `\t\treturn ${vc.call}`
				return `\tif ${condFor(h)} {\n${pre ? pre + '\n' : ''}${ret}\n\t}`
			}
		)
		const checkArms = list(sseFns, (h) => `\tif ${condFor(h)} { return }`)
		const emitArms = list(
			sseFns.filter((h) => isEmitFn(h)),
			(h) => {
				const narrow = h.params.slice(0, -1)
				const isReq = narrow.length === 1 && narrow[0].vtype === 'SwelteRequest'
				const built = isReq ? null : narrowCall(`${prefix}${h.name}`, narrow)
				const callArgs = isReq ? `req, emit` : narrow.length ? `${built!.call}, emit` : `emit`
				const pre =
					built && built.stmts.length ? built.stmts.map((st) => `\t\t${st}`).join('\n') + '\n' : ''
				const run = h.fallible
					? `\t\t${prefix}${h.name}(${callArgs}) or { return err }`
					: `\t\t${prefix}${h.name}(${callArgs})`
				return `\tif ${condFor(h)} {\n${pre}${run}\n\t\treturn\n\t}`
			}
		)
		return `
pub fn ${prefix}sse_events(qualifier string, req SwelteRequest) ![]string {
${arm(eventsArms, qualErr)}
}

pub fn ${prefix}sse_is_emit() bool {
\treturn ${sseFns.some((h) => isEmitFn(h))}
}

pub fn ${prefix}sse_check_qual(qualifier string) ! {
${arm(checkArms, qualErr)}
}

pub fn ${prefix}sse_emit(qualifier string, req SwelteRequest, emit fn (string) bool) ! {
${arm(emitArms, qualErr)}
}
`
	}

	/** Loader cascade: `swelte_load(req)` runs ancestor +route `@[load]`
	 * fns root-first; each level returns its typed value (struct, map,
	 * string, array — any JSON-able V type). The cascade threads values:
	 * level N receives level N-1's return as `parent` (typed, already
	 * built — no decode, no JSON in `.v` files). The leaf's return is
	 * `json.encode`d once at the edge → page props.
	 * No loads anywhere → `'{}'`. Any throw → error (caller maps to +error).
	 * Each load is called under its OWNING file's prefix (wrappers are
	 * inlined under the wrapper prefix — same as @[before]/@[after]). */
	function emitLoadCascade(prefix: string, loads: LoadFn[]): string {
		if (loads.length === 0)
			return `
pub fn ${prefix}swelte_load(req SwelteRequest) !string {
\treturn '{}'
}
`
		const fnPrefix = (l: LoadFn): string => vPrefix(l.mod)
		const chained = loads
			.map((l, i) =>
				i === 0
					? `\tmut frag_${i} := ${fnPrefix(l)}${l.name}(req) or { return err }`
					: `\tmut frag_${i} := ${fnPrefix(l)}${l.name}(req, frag_${i - 1}) or { return err }`
			)
			.join('\n')
		const leaf = loads.length - 1
		return `
pub fn ${prefix}swelte_load(req SwelteRequest) !string {
${chained}
\treturn json.encode(frag_${leaf})
}
`
	}

	/** Extracted verb/rpc body (unchanged semantics — moved verbatim out
	 * of emitRouteFile so both chained and unchained leaves share it).
	 * `sharedReq`: §7 pre-chain request (already @[before]-filtered) —
	 * verb branches reuse it instead of building their own; null =
	 * build locally (byte-identical to the old inline code). */
	function dispatchBody(
		prefix: string,
		mod: string,
		fns: RpcFn[],
		sharedReq: string | null
	): string {
		// Shared prelude + arms per transport: RPC decodes the JSON envelope once;
		// verbs branch per method arm. Each arm is a self-contained string —
		// no `o.push` scaffolding, joined once at the end like emitServerGen.
		const rpcFns = fns.filter((f) => f.attr === 'rpc')
		const sseFns = fns.filter((f) => f.attr === 'sse')
		const rpcArm = (fn: RpcFn): string => {
			const rs = fn.singleArgsStruct ? vType(fn.singleArgsStruct, mod) : null
			const dec = rs
				? `json.decode(${rs}, args_json) or { return swelte_err_bad_cookies(path, fn_name, 'bad args') }`
				: `args_json`
			const call = `${prefix}${fn.name}(${dec})`
			const ck = `swelte_set_cookies_for_${prefix}${fn.name}()`
			const body = fn.fallible
				? `\t\t\tres := ${call} or { return swelte_err_bad_cookies(path, fn_name, err.msg()) }
${fn.vret === 'void' ? `\t\t\treturn 200, '{}', ${ck}` : `\t\t\treturn 200, json.encode(res), ${ck}`}`
				: fn.vret === 'void'
					? `\t\t\t${call}
			return 200, '{}', ${ck}`
					: `\t\t\treturn 200, json.encode(${call}), ${ck}`
			return `\t\tif fn_name == ${vJsonStr(fn.name)} {
${body}
		}`
		}
		const avail = '[' + rpcFns.map((f) => vJsonStr(f.name)).join(', ') + ']'
		const rpcHead = `\tif method == 'POST' && (content_type.contains('application/json') || content_type == '') {\n\t\tparsed := json2.decode[map[string]json2.Any](body) or {\n\t\t\treturn swelte_err_bad_cookies(path, '', 'bad json body')\n\t\t}\n\t\tfn_any := parsed['fn'] or {\n\t\t\treturn swelte_err_bad_cookies(path, '', 'missing fn')\n\t\t}\n\t\tfn_name := fn_any.str().trim('"')\n\t\targs_any := parsed['args'] or { json2.Any(json2.null) }\n\t\targs_json := json2.encode(args_any)`
		const rpcTail = `\t\tif fn_name == '' {\n\t\t\treturn swelte_err_bad_cookies(path, fn_name, 'missing fn')\n\t\t}\n\t\treturn swelte_err_unknown_cookies(path, fn_name, ${avail})\n\t}`
		const rpcBlock = rpcFns.length === 0 ? '' : [rpcHead, list(rpcFns, rpcArm), rpcTail].join('\n')
		// §7: @[after] runs on the outcome: @[before] failures never reach
		// the verbs body (they return 4xx from dispatch), so @[after]
		// only observes real verb outcomes — no error attr possible here.
		// §10: unknown method on an endpoint-less file is 405; mutating
		// verbs on an RPC-less path shape is 403 (CSRF-relevant: plain
		// cross-site forms can only send GET/POST, so POST here is safe).
		const methodGate: string =
			sharedReq == null ? `swelte_method_not_allowed()` : `swelte_method_gate(method)`
		// SSE (roadmap §14, true streaming via veb): GET-only. One
		// `@[sse]` fn per file (qualifier rules mirror verbs: default
		// or `('q')`, unique per file). The fn returns a LIST of event
		// payloads (`[]string`). The dispatch SSE arm does NOT emit a
		// body — instead `before_request` (which owns `ctx`) checks for
		// SSE intent FIRST via the generated `swelte_is_sse_route` +
		// per-file match, takes over the conn, and streams. Dispatch
		// stays pure (status/body/cookies) for the JSON watchdog path.
		// This arm only validates qualifiers for SSE routes so direct
		// dispatch calls still 404 unknown qualifiers correctly.
		const sseQuals = sseFns.filter((h) => h.qualifier).map((h) => h.qualifier as string)
		const sseCheck =
			sseQuals.length === 0
				? `\t\tif qualifier != '' { return swelte_err_unknown_qual_cookies(path, []) }`
				: `\t\tif qualifier != '' && qualifier !in [${sseQuals.map((q) => vJsonStr(q)).join(', ')}] { return swelte_err_unknown_qual_cookies(path, [${sseQuals.map((q) => vJsonStr(q)).join(', ')}]) }`
		const sseArm =
			sseFns.length === 0
				? ''
				: `\tif method == 'GET' && headers['Accept'] or { headers['accept'] or { '' } }.contains('text/event-stream') {\n${sseCheck}\n\t\treturn swelte_err_bad_cookies(path, '', 'sse handled in before_request')\n\t}`
		// §13: with @[before] wrappers the request already exists
		// (pre-filtered `swelte_req`, parsed once in dispatch) — reuse
		// it directly, no second multipart parse. Unchained leaves
		// parse here (form/files declared only in that branch).
		const reqHead = (vb: string): string =>
			sharedReq != null
				? `\t\treq = ${sharedReq}\n\t\treq.method = '${vb.toUpperCase()}'`
				: `\t\tmut form := map[string]string{}\n\t\tmut files := map[string]string{}\n\t\tif content_type.contains('multipart/form-data') {\n\t\t\tmut boundary := ''\n\t\t\tfor part in content_type.split(';') {\n\t\t\t\tp := part.trim_space()\n\t\t\t\tif p.starts_with('boundary=') { boundary = p.all_after('boundary=').trim('"') }\n\t\t\t}\n\t\t\tmut swelte_raw_files := map[string][]http.FileData{}\n\t\t\tif boundary != '' { form, swelte_raw_files = http.parse_multipart_form(body, boundary) }\n\t\t\tfor k, fs in swelte_raw_files {\n\t\t\t\tmut swelte_names := []string{}\n\t\t\t\tfor f in fs { swelte_names << f.filename }\n\t\t\t\tfiles[k] = swelte_names.join(';')\n\t\t}\n\t\t} else if content_type.contains('application/x-www-form-urlencoded') || body != '' {\n\t\t\tform = http.parse_form(body)\n\t\t}\n\t\tmut req := SwelteRequest{ query: query, form: form, files: files, headers: headers, cookies: cookies, params: params, method: '${vb.toUpperCase()}', path: path, qualifier: qualifier }`
		const verbArm = (vb: string): string => {
			const hs = fns.filter((f) => f.attr === vb)
			if (hs.length === 0) return ''
			const quals = hs.filter((h) => h.qualifier).map((h) => h.qualifier as string)
			const tail = quals.length
				? `\t\treturn swelte_err_unknown_qual_cookies(path, [${quals.map((q) => vJsonStr(q)).join(', ')}])`
				: `\t\treturn swelte_err_bad_cookies(path, '', 'missing qualifier')`
			return [
				`\tif method == '${vb.toUpperCase()}' {`,
				reqHead(vb),
				list(hs, verbBranch),
				tail,
				`\t}`,
			].join('\n')
		}
		const verbBranch = (h: RpcFn): string => {
			const cond = h.qualifier ? `qualifier == ${vJsonStr(h.qualifier)}` : `qualifier == ''`
			const isReq = h.params.length === 1 && h.params[0].vtype === 'SwelteRequest'
			const built = isReq ? null : narrowCall(`${prefix}${h.name}`, h.params)
			const call = isReq ? `${prefix}${h.name}(req)` : built!.call
			const ck = `swelte_set_cookies_for_${prefix}${h.name}()`
			const stmts = list(built?.stmts ?? [], (st) => `\t\t\t${st}\n`)
			const body = h.fallible
				? `\t\t\tres := ${call} or { return swelte_err_bad_cookies(path, ${vJsonStr(h.name)}, err.msg()) }\n${h.vret === 'void' ? `\t\t\treturn 200, '{}', ${ck}` : `\t\t\treturn 200, json.encode(res), ${ck}`}`
				: h.vret === 'void'
					? `\t\t\t${call}\n\t\t\treturn 200, '{}', ${ck}`
					: `\t\t\treturn 200, json.encode(${call}), ${ck}`
			return `\t\tif ${cond} {\n${stmts}${body}\n\t\t}`
		}
		const tail =
			sharedReq == null && fns.some((f) => f.attr === 'get')
				? `\treturn swelte_method_not_allowed()`
				: `\treturn ${methodGate}`
		return [
			rpcBlock,
			sseArm,
			...['get', 'post', 'put', 'delete', 'patch'].map(verbArm),
			tail,
			`}\n`,
		]
			.filter((s) => s !== '')
			.join('\n')
	}

/** Codegen: fetch stub for a `#routes/*.v` file. Big `v` template -
  verbatim JS with `${}` inserts (no per-line push/escaping).
  Single exported source: `generate()`'s load path calls this directly
  (no closure copy). Nested only because it reads `isBuild` + `list`. */
function jsFetchFor(route: string, fns: RpcFn[]): string {
		const hasDyn = route.includes('[')
		const dynSeg = /\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]|\[([A-Za-z_][A-Za-z0-9_]*)\]/
		const dynHelper = hasDyn
			? `
const __swelteBase = ${JSON.stringify(route)}
function __swelteUrl(args = {}) {
	let u = __swelteBase
  for (const m of __swelteBase.matchAll(${dynSeg.source}/g)) {
		const name = m[1] ?? m[2]
		const v = args?.[name]
		if (v === undefined || v === null) throw new Error(\`swelte: missing route param '\${name}' for \${__swelteBase}\`);
    const enc = m[1] !== undefined ? String(v).split("/").map(encodeURIComponent).join("/") : encodeURIComponent(String(v));
    u = u.replace(m[0], enc);
  }
	return u
}
`
			: ''
		const stripCall = (call: string) => `
	const { __swelteRest, ...__swelteArgs } = (() => {
		const c = { ...(args ?? {}) }
    for (const m of __swelteBase.matchAll(${dynSeg.source}/g)) delete c[m[1] ?? m[2]];
    return c;
  })();
	void __swelteRest
  ${call}
`
		return `// Auto-generated by swelte from V signatures. Do not edit.
import { __swelteFetch${fns.some((f) => f.attr === 'sse') ? ', __swelteStream' : ''} } from '@swelte/core'

${dynHelper}${list(fns, (fn) => {
	const kind = fn.attr === 'sse' ? 'async function *' : 'function'
	const q = JSON.stringify(fn.qualifier ?? '')
	const nm = JSON.stringify(fn.name)
	const attr = JSON.stringify(fn.attr)
	if (hasDyn && fn.attr === 'sse')
		return `export ${kind} ${fn.name}(args = {}) {${stripCall(`yield* __swelteStream(__swelteUrl(args), ${nm}, __swelteArgs, ${q})`)}}
`
	if (fn.attr === 'sse')
		return `export ${kind} ${fn.name}(args = {}) {
	yield* __swelteStream(${JSON.stringify(route)}, ${nm}, args, ${q})
}

`
	if (hasDyn)
		return `export ${kind} ${fn.name}(args = {}) {${stripCall(`return __swelteFetch(__swelteUrl(args), ${nm}, ${attr}, __swelteArgs, ${q})`)}}
`
	return `export ${kind} ${fn.name}(args = {}) {
	return __swelteFetch(${JSON.stringify(route)}, ${nm}, ${attr}, args, ${q})
}

`
})}`
	}

/** Codegen: WASM stub for a `#lib/*.v` file. Big `v` template.
 * Single exported contract: `isBuild` selects the prod bundle URL vs
 * the dev per-module URL. Nested only because it reads `isBuild`+`list`. */
function jsWasmFor(isBuild: boolean, mod: string, fns: RpcFn[]): string {
		const wasmUrl = isBuild ? '/assets/app_lib.wasm' : '/@swelte-dev/' + mod + '.wasm'
		return `// Auto-generated by swelte from ${mod}.v \u2014 do not edit.
import { __swelteWasmCall } from '@swelte/core'
const wasmUrl = ${JSON.stringify(wasmUrl)}

${list(fns, (fn) => {
	const params = JSON.stringify(
		fn.params.map((p) => ({
			name: p.name,
			kind: wasmParamKind(p.vtype) || 'unsupported',
			vtype: p.vtype,
		}))
	)
	const ret = JSON.stringify(wasmReturnKind(fn.vret) || 'unsupported')
	return `const ${fn.name}_params = ${params}
export function ${fn.name}(args) {
	return __swelteWasmCall(wasmUrl, 'main.${fn.name}', args, ${fn.name}_params, ${ret})
}

`
})}`
	}

	function generate(root: string): Promise<void> {
		const run = genChain.then(() =>
			(async () => {
				// Unified config is the source of truth: unspecified plugin
				// options fall back to the `swelte` key in svelte.config.js.
				// Explicit plugin options always win (back-compat).
				try {
					const { loadConfig } = await import('./gen/config.js')
					const cfg = await loadConfig(root)
					if (options.routesDir === undefined) routesDir = cfg.routesDir
					if (options.libDir === undefined) libDir = cfg.libDir
					if (options.outDir === undefined) outDir = cfg.outDir
				} catch {
					/* defaults stand */
				}
				const genDir = resolve(root, outDir)
				const typesDir = join(genDir, 'types')
				mkdirSync(genDir, { recursive: true })
				mkdirSync(typesDir, { recursive: true })
				const warnings: string[] = []
				const dispatched: { route: string; mod: string; prefix: string }[] = []

				function vSafe(mod: string): string {
					return vFileSafe(mod)
				}

				function emitTypes(
					sub: string,
					mod: string,
					src: string,
					fns: RpcFn[],
					route = ''
				): string {
					const dir = join(typesDir, sub, mod.split('/').slice(0, -1).join('/'))
					mkdirSync(dir, { recursive: true })
					const base = mod.split('/').pop() || 'index'
					const file = join(dir, `${base}.d.ts`)
					const out: string[] = ['// Auto-generated by swelte from V signatures. Do not edit.', '']
					if (fns.some((f) => f.attr !== 'rpc')) {
						out.push(`export interface SwelteRequest {
	query: Record<string, string>
	form: Record<string, string>
	files: Record<string, string>
	headers: Record<string, string>
	cookies: Record<string, string>
	params: Record<string, string>
	method: string
	path: string
	qualifier: string
}
`)
					}
					const structBlock = (st: VStruct): string => {
						for (const fld of st.fields) {
							if (fld.tstype === 'unknown')
								warnings.push(
									`${sub}/${mod}.${st.name}.${fld.name}: unknown V type '${fld.vtype}' → unknown`
								)
						}
						return `export interface ${st.name} {
${list(st.fields, (fld) => `\t${fld.name}${fld.optional ? '?' : ''}: ${fld.tstype} // ${fld.vtype}\n`)}}
`
					}
					for (const st of parseStructs(src)) out.push(structBlock(st))
					const resAlias = (fn: RpcFn): string => {
						const Res = `${pascal(fn.name)}Result`
						const fallible = fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''
						const ret = fn.tsret === 'void' ? 'void' : fn.tsret
						if (fn.tsret === 'unknown' && fn.vret !== 'unknown')
							warnings.push(
								`${sub}/${mod}.${fn.name} return: unknown V type '${fn.vret}' → unknown`
							)
						if (/^[A-Z][A-Za-z0-9_]*$/.test(fn.vret))
							return `export type ${Res} = ${fn.vret}${fallible}`
						if (
							/^[a-z][A-Za-z0-9_]*$/.test(fn.vret) &&
							fn.vret !== 'void' &&
							fn.vret !== 'string' &&
							fn.vret !== 'number' &&
							fn.vret !== 'boolean'
						)
							return `// ${fn.name} returns V builtin ${fn.vret} (see above).\nexport type ${Res} = unknown`
						return `export type ${Res} = ${ret}${fallible}`
					}
					const argsBlock = (fn: RpcFn, params: RpcParam[], Arg: string): string => {
						for (const p of params) {
							if (p.tstype === 'unknown')
								warnings.push(
									`${sub}/${mod}.${fn.name} param ${p.name}: unknown V type '${p.vtype}' → unknown`
								)
						}
						return `export interface ${Arg} {
${list(params, (p) => `\t${p.name}${p.optional ? '?' : ''}: ${p.tstype}\n`)}}
`
					}
					for (const fn of fns) {
						const isVerb = fn.attr !== 'rpc'
						// Verb handlers take the framework SwelteRequest (query, form,
						// headers, cookies, method, path, qualifier) and return a
						// response value. @[rpc] fns take one args-struct (free-form
						// args/return) and return the projected type.
						if (isVerb) {
							// Request-shaped verb fn: (req SwelteRequest) or bare.
							// Optional client args object → query (GET/DELETE) or
							// form (POST/PUT/PATCH) fields. No Args interface is
							// EVER synthesized for Request fns: the `req` param is
							// server-built, not caller-supplied.
							const isReq =
								(fn.params.length === 1 && fn.params[0].vtype === 'SwelteRequest') ||
								(fn.params.length === 1 && fn.params[0].name === 'req')
							const fallibleCmt = fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''
							const ret = fn.tsret === 'void' ? 'void' : fn.tsret
							if (fn.tsret === 'unknown' && fn.vret !== 'unknown')
								warnings.push(
									`${sub}/${mod}.${fn.name} return: unknown V type '${fn.vret}' → unknown`
								)
							const Res = `${pascal(fn.name)}Result`
							const resAlias = /^[A-Z][A-Za-z0-9_]*$/.test(fn.vret)
								? `export type ${Res} = ${fn.vret}${fallibleCmt}`
								: /^[a-z][A-Za-z0-9_]*$/.test(fn.vret) &&
										fn.vret !== 'void' &&
										fn.vret !== 'string' &&
										fn.vret !== 'number' &&
										fn.vret !== 'boolean'
									? `// ${fn.name} returns V builtin ${fn.vret} (see above).\nexport type ${Res} = unknown`
									: `export type ${Res} = ${ret}${fallibleCmt}`
							out.push(resAlias)
							if (fn.attr === 'sse') {
								// SSE (roadmap §14, true streaming via veb): two shapes.
								// List mode: fn returns `[]string` (event list, streamed
								// per-event). Emit mode: fn takes a trailing
								// `emit fn (string) bool` param and returns void/`!void`;
								// each `emit(e)` flushes one frame NOW (`if !emit(e) {
								// return }` on disconnect). Emit and list are exclusive.
								const emitParam = fn.params.length > 0 ? fn.params[fn.params.length - 1] : null
								const isEmit =
									emitParam !== null &&
									/^fn\s*\(\s*string\s*\)(\s*bool)?$/.test(emitParam.vtype.trim())
								if (isEmit) {
									if (fn.vret !== 'void') {
										const msg = `[swelte] ${sub}/${mod}.v: @[sse] ${fn.name} with emit param must return void (emit flushes per-event; got ${fn.vret || 'none'})`
										warnings.push(msg)
										throw new Error(msg)
									}
								} else if (fn.vret !== '[]string') {
									const msg = `[swelte] ${sub}/${mod}.v: @[sse] ${fn.name} must return []string (event list) or take a trailing emit fn (string) bool param (got ${fn.vret || 'none'})`
									warnings.push(msg)
									throw new Error(msg)
								}
								// Emit param is harness-injected (never client-supplied):
								// strip it from the Args interface. `isReq` covers the
								// (req) and (req, emit) shapes; bare multi-param fns
								// keep their narrow args minus emit.
								const clientParams = isEmit ? fn.params.slice(0, -1) : fn.params
								const clientIsReq =
									(clientParams.length === 1 && clientParams[0].vtype === 'SwelteRequest') ||
									(clientParams.length === 1 && clientParams[0].name === 'req')
								if (!clientIsReq && clientParams.length) {
									out.push(`export interface ${pascal(fn.name)}Args {`)
									for (const p of clientParams) {
										if (p.tstype === 'unknown')
											warnings.push(
												`${sub}/${mod}.${fn.name} param ${p.name}: unknown V type '${p.vtype}' → unknown`
											)
										out.push(`\t${p.name}${p.optional ? '?' : ''}: ${p.tstype}`)
									}
									out.push('}')
									out.push(
										`export function ${fn.name}(args: ${pascal(fn.name)}Args): AsyncGenerator<string, void, void>${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
									)
								} else if (clientIsReq) {
									const dynPs = routeParams(route)
									if (dynPs.length) {
										out.push(
											`export function ${fn.name}(args: { ${dynPs.map((n) => `${n}: string`).join(', ')} } & Record<string, string>): AsyncGenerator<string, void, void>${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
										)
									} else {
										out.push(
											`export function ${fn.name}(args?: Record<string, string>): AsyncGenerator<string, void, void>${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
										)
									}
								} else {
									out.push(`// ${fn.name} takes no args (SSE handler without params).`)
									out.push(`export function ${fn.name}(): AsyncGenerator<string, void, void>`)
								}
								out.push('')
								continue
							}
							if (
								!isReq &&
								fn.params.length &&
								!(fn.params.length === 1 && fn.params[0].name === 'req')
							) {
								out.push(`export interface ${pascal(fn.name)}Args {`)
								for (const p of fn.params) {
									if (p.tstype === 'unknown')
										warnings.push(
											`${sub}/${mod}.${fn.name} param ${p.name}: unknown V type '${p.vtype}' → unknown`
										)
									out.push(`\t${p.name}${p.optional ? '?' : ''}: ${p.tstype}`)
								}
								out.push('}')
								out.push(
									`export function ${fn.name}(args: ${pascal(fn.name)}Args): Promise<${Res}>`
								)
							} else if (isReq) {
								const dynPs = routeParams(route)
								if (dynPs.length) {
									out.push(
										`export function ${fn.name}(args: { ${dynPs.map((n) => `${n}: string`).join(', ')} } & Record<string, string>): Promise<${Res}>`
									)
								} else {
									out.push(
										`export function ${fn.name}(args?: Record<string, string>): Promise<${Res}>`
									)
								}
							} else {
								out.push(`// ${fn.name} takes no args (verb handler without params).`)
								out.push(`export function ${fn.name}(): Promise<${Res}>`)
							}
							out.push('')
							continue
						}
						const Arg = fn.singleArgsStruct ?? `${pascal(fn.name)}Args`
						if (!fn.singleArgsStruct) {
							out.push(`export interface ${Arg} {`)
							for (const p of fn.params) {
								if (p.tstype === 'unknown')
									warnings.push(
										`${sub}/${mod}.${fn.name} param ${p.name}: unknown V type '${p.vtype}' → unknown`
									)
								out.push(`\t${p.name}${p.optional ? '?' : ''}: ${p.tstype}`)
							}
							out.push('}')
						} else {
							out.push(`// ${fn.name} args: see interface ${Arg} above (V single-args-struct).`)
						}
						const ret = fn.tsret === 'void' ? 'void' : fn.tsret
						if (fn.tsret === 'unknown' && fn.vret !== 'unknown')
							warnings.push(
								`${sub}/${mod}.${fn.name} return: unknown V type '${fn.vret}' → unknown`
							)
						const Res = `${pascal(fn.name)}Result`
						if (/^[A-Z][A-Za-z0-9_]*$/.test(fn.vret)) {
							out.push(
								`export type ${Res} = ${fn.vret}${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
							)
						} else if (
							/^[a-z][A-Za-z0-9_]*$/.test(fn.vret) &&
							fn.vret !== 'void' &&
							fn.vret !== 'string' &&
							fn.vret !== 'number' &&
							fn.vret !== 'boolean'
						) {
							out.push(`// ${fn.name} returns V builtin ${fn.vret} (see above).`)
							out.push(`export type ${Res} = unknown`)
						} else {
							out.push(
								`export type ${Res} = ${ret}${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
							)
						}
						// Value signature: `import { fn } from '#…/x.v'` typechecks without a value shim.
						// Args are always the single args-struct (or the synthesized Args interface).
						out.push(`export function ${fn.name}(args: ${Arg}): Promise<${Res}>`)
						out.push('')
					}
					writeFileSync(file, out.join('\n'))
					return file
				}

				function backendImportLines(src: string): { imp: string; line: number }[] {
					const out: { imp: string; line: number }[] = []
					const lines = src.split('\n')
					for (let i = 0; i < lines.length; i++) {
						const m = /^\s*import\s+(.+)$/.exec(lines[i])
						if (!m) continue
						for (const part of m[1].split(',')) {
							const p = part.trim()
							if (!p || p.startsWith('//')) continue
							const token = (p.split(/\s+/).pop() as string).replace(/['"]/g, '')
							// V-to-V backend include: `#lib/backend/...`, `lib/backend/...`,
							// `backend/...` (slash or V-dot style: `backend.secrets`), or
							// `*_backend(.v)`. Stdlib (`os`, `time`, …) never matches —
							// §18 owns that rule.
							const segs = token.split(/[/.]/).map((s) => s.replace(/\.v$/, ''))
							if (segs.includes('backend') || segs[segs.length - 1]?.endsWith('_backend')) {
								out.push({ imp: token, line: i + 1 })
							}
						}
					}
					return out
				}

				// Layout (spec v-imports.md §2): routes → server fetch stubs,
				// lib → isomorphic WASM stubs. Types land under types/routes|lib so
				// the *.v resolveId/load below can re-export them 1:1.
				const routesAbs = resolve(root, routesDir)
				const libAbs = resolve(root, libDir)
				// Deterministic input order: listVFiles sorts per-dir, but
				// `dispatched` (hence server_gen route order) must be fully
				// sorted by mod too — readdir order otherwise leaks into output.
				const routeFiles = listVFiles(routesAbs).sort()
				const vMods = new Set(routeFiles.map((f) => modulePath(routesAbs, f)))
				// Unconditional folder-root double-claim, EITHER extension on
				// EITHER side: `foo.svelte` vs `foo/+page.*`
				// collide even when only one side has a `.v` file. Scan `.v`
				// leaves AND `.svelte` leaves directly.
				for (const f of [...routeFiles, ...listFilesWithExt(routesAbs, '.svelte')].sort()) {
					const rel = relPosix(routesAbs, f)
					const mod = f.endsWith('.svelte')
						? rel.replace(/\.svelte$/, '')
						: modulePath(routesAbs, f)
					const slash = mod.lastIndexOf('/')
					const base = slash < 0 ? mod : mod.slice(slash + 1)
					const dir = slash < 0 ? '' : mod.slice(0, slash)
					if (base !== '+page' && base !== 'index') continue
					if (dir === '') continue // root +page has no sibling to collide with
					// +route wrappers never compete (checked before this loop
					// for .v; .svelte wrappers can't be leaves here by kind).
					if (svelteModKind(mod) === 'wrapper') continue
					for (const sib of [`${dir}.svelte`, `${dir}.v`]) {
						if (existsSync(join(routesAbs, sib))) {
							throw new Error(
								`[swelte] ${routesDir}/${sib} claims the same URL as ${routesDir}/${rel} — one file per URL (guarded URLs live inside their guard's directory; keep the +page leaf).`
							)
						}
					}
				}
				{
					for (const f of routeFiles) {
						const src = readFileSync(f, 'utf8')
						const allFns = parseVFile(src)
						const mwFns = allFns.filter((x) => x.attr === 'before' || x.attr === 'after')
						const fns = allFns.filter((x) => x.attr !== 'before' && x.attr !== 'after')
						const rpcFns = fns.filter((x) => x.attr === 'rpc')
						const verbFns = fns.filter((x) => x.attr !== 'rpc')
						const mod = modulePath(routesAbs, f)
						const rel = relPosix(routesAbs, f)
						const isWrapper = mod === '+route' || mod.endsWith('/+route')
						if (isWrapper) {
							const loads = allFns.filter((x) => x.attr === 'load')
							if (loads.length > 1)
								throw new Error(
									`[swelte] ${routesDir}/${rel}: two @[load] fns (${loads.map((l) => l.name).join(', ')}) — one loader per file (each +route level aggregates its own, leaf merges all).`
								)
							const endpoints = fns.filter((x) => x.attr !== 'load')
							if (endpoints.length > 0)
								throw new Error(
									`[swelte] ${routesDir}/${rel}: @[rpc]/verb handlers are not allowed in +route.v (wrapper: @[before]/@[after]/@[load] only).`
								)
							for (const m of mwFns) validateMiddlewareFn(`${routesDir}/${rel}`, m)
							// chain types validated at emit site (loads assembled per-leaf below).
							// Wrappers are +layout-shaped: no callable exports, but
							// their `pub struct`s are shared with the client.
							// Emit types only — no fetch stub, no route.
							emitTypes('routes', mod, src, [])
							continue
						}
						// Log the file set ONCE per generate (debug): routeGen flip
						// between `/x` and `/x/+page` diagnosis.
						for (const m of mwFns)
							throw new Error(
								`[swelte] ${routesDir}/${rel}: @[${m.attr}] ${m.name} is only allowed in +route.v wrappers.`
							)
						// +route.v wrappers claim no URL — they returned above, so
						// every file reaching here competes for its URL.
						doubleClaimCheck(routesAbs, routesDir, mod, rel)
						// Orphan/leaf-index checks (spec §2): warn, don't fail.
						if (mod !== 'index' && mod !== '+page' && !mod.startsWith('api/')) {
							const sveltePartner = join(routesAbs, `${mod}.svelte`)
							const svelteIndex = join(routesAbs, mod, 'index.svelte')
							const sveltePage = join(routesAbs, mod, '+page.svelte')
							/* Really noisy and useless warning
					if (!existsSync(sveltePartner) && !existsSync(svelteIndex) && !existsSync(sveltePage)) {
						warnings.push(
							`${routesDir}/${mod}.v: no .svelte partner (page) and not under api/ — orphan route file`
						)
					}*/
						}
						if (rpcFns.length === 0 && verbFns.length === 0 && fns.every((x) => x.attr !== 'sse'))
							continue
						// @[load]: at most one per leaf file; never stacked with
						// a verb/rpc/sse on the same fn (one transport per fn).
						// Signature: (SwelteRequest, parent string) — parent is
						// the aggregated JSON from ancestor +route loads
						// (root-first). Leaf merges and returns the page props.
						const loads = fns.filter((x) => x.attr === 'load')
						if (loads.length > 1)
							throw new Error(
								`[swelte] ${routesDir}/${rel}: two @[load] fns (${loads.map((l) => l.name).join(', ')}) — one loader per file.`
							)
						for (const l of loads) {
							// chain types validated at emit site (loads assembled per-leaf below).
							const clash = allFns.find((x) => x.name === l.name && x.attr !== 'load')
							if (clash)
								throw new Error(
									`[swelte] ${routesDir}/${rel}: @[load] on ${l.name} cannot stack with @[${clash.attr}] — one transport per fn. Split into two fns.`
								)
						}
						// One-default-per-verb + unique qualifier: build error
						// (ambiguous routing — roadmap item 15). SSE mirrors the
						// verb rules (default or ('q'), unique per file) but is
						// GET+Accept-gated, so an `@[sse]` default coexists with an
						// `@[get]` default on the same file (§14). Stacking `@[sse]`
						// with a verb (`@[get; sse]`, `@[rpc; sse]`) on one fn is a
						// build error — parseVFile fans stacked attrs out to one
						// RpcFn per verb, so the same name shows up twice.
						for (const m of allFns.filter((x) => x.attr === 'sse')) {
							const clash = allFns.find((x) => x.name === m.name && x.attr !== 'sse')
							if (clash)
								throw new Error(
									`[swelte] ${routesDir}/${rel}: @[sse] on ${m.name} cannot stack with @[${clash.attr}] — one transport per fn (SSE is GET+Accept-gated, verbs are method-gated). Split into two fns.`
								)
						}
						for (const vb of ['get', 'post', 'put', 'delete', 'patch', 'sse']) {
							const hs = fns.filter((x) => x.attr === vb)
							const defaults = hs.filter((x) => !x.qualifier)
							if (defaults.length > 1) {
								const msg = `[swelte] ${routesDir}/${mod}.v: two @[${vb}] defaults (${defaults.map((d) => d.name).join(', ')}) — one default per verb per file`
								warnings.push(msg)
								throw new Error(msg)
							}
							const seen = new Map<string, string>()
							for (const h of hs) {
								if (!h.qualifier) continue
								if (seen.has(h.qualifier)) {
									const msg = `[swelte] ${routesDir}/${mod}.v: duplicate @[${vb}('${h.qualifier}')] on ${seen.get(h.qualifier)} and ${h.name}`
									warnings.push(msg)
									throw new Error(msg)
								}
								seen.set(h.qualifier, h.name)
							}
						}
						const route = routeFor(routesDir, routesAbs, f)
						if (route === null) continue // wrapper-only (handled above); leaf always has a route
						emitTypes('routes', mod, src, fns, route)
						// Dynamic-shape clash (section 8): two files normalizing to the
						// same shape (`users/[id]` vs `users/[slug]`) are ambiguous —
						// build error naming both files.
						for (const d of dispatched) {
							const shA = d.route.replace(/\[\.\.\.[^\]]+\]/g, '...').replace(/\[[^\]]+\]/g, '[]')
							const shB = (route as string)
								.replace(/\[\.\.\.[^\]]+\]/g, '...')
								.replace(/\[[^\]]+\]/g, '[]')
							if (route.includes('[') && shA === shB)
								throw new Error(
									`[swelte] ${routesDir}/${rel} has the same dynamic shape as ${routesDir}/${d.mod}.v (${shB}) — rename one file.`
								)
						}
						// §10: @[sets_cookie] only on @[rpc]/verb fns; never on
						// @[before]/@[after] middleware or +route.v wrapper endpoints
						// (wrappers declare no endpoints of their own, §7). The
						// multi-attr form is @[rpc; sets_cookie] on one fn.
						for (const fn of allFns) {
							if (fn.setsCookie && (fn.attr === 'before' || fn.attr === 'after'))
								throw new Error(
									`[swelte] ${routesDir}/${rel}: @[sets_cookie] on ${fn.name} — middleware (@[before]/@[after]) cannot set cookies; put it on an @[rpc]/verb handler.`
								)
						}
						dispatched.push({ route, mod, prefix: vPrefix(mod) })
						// Runtime fetch stub for the browser import (dev + build).
						// Sorted by mod: readdir order is filesystem-dependent;
						// the stubs land per-mod but keep them deterministic too.
						const genModDir = join(
							genDir,
							'generated',
							'routes',
							mod.split('/').slice(0, -1).join('/')
						)
						mkdirSync(genModDir, { recursive: true })
						writeFileSync(join(genModDir, `${mod.split('/').pop()}.js`), jsFetchFor(route, fns))
					}
					// Per-file dispatchers: one `module routes` file per routes file,
					// all under `.swelte/routes/` (never the project root). The v
					// toolchain compiles `.swelte/` as one unit (harness + routes).
					// Naming (.v + flat stems like `_page.v`) collided when
					// `+page` and `+route` flattened alike — vFileSafe maps `/`
					// to `__` so leaf and wrapper names never collide.
					const routesGenDir = join(genDir, 'routes')
					const seenMods = new Set<string>()
					// NOTE: `routes/` once held a file literally named `routes/`
					// from an older flat scheme — wipe semantics: rewrite the
					// whole dir (write fresh AFTER deleting stale), so renamed
					// routes (index.v → +page.v) never leave ghosts.
					for (const d of dispatched) {
						if (seenMods.has(d.mod)) continue
						seenMods.add(d.mod)
						// Source of truth is ALWAYS src/routes (routesAbs) —
						// never the generated output dir (same leaf names exist
						// in both; reading output back as input made routeFor
						// flip between `/x` and `/x/+page` on alternating runs).
						const src = readFileSync(join(routesAbs, `${d.mod}.v`), 'utf8')
						// §7: per-leaf ancestor chain (ancestors' +route.v middleware,
						// inlined by emitRouteFile). A leaf with no wrappers passes
						// an empty chain (byte-identical output).
						const leafDir = leafDirOf(d.mod)
						const chain: WrapperMw[] = []
						const loads: LoadFn[] = []
						for (const dir of ancestorDirs(leafDir)) {
							const wmod = dir === '' ? '+route' : `${dir}/+route`
							if (wmod === d.mod) continue
							const wf = join(routesAbs, ...wmod.split('/')) + '.v'
							if (!existsSync(wf)) continue
							const wsrc = readFileSync(wf, 'utf8')
							const mws = parseVFile(wsrc).filter((x) => x.attr === 'before' || x.attr === 'after')
							const lds = parseVFile(wsrc).filter((x) => x.attr === 'load')
							if (mws.length === 0 && lds.length === 0) continue
							chain.push({
								wmod,
								src: wsrc,
								mws: mws.map((m) => ({ name: m.name, attr: m.attr as 'before' | 'after' })),
							})
							for (const l of lds) loads.push({ ...l, mod: wmod, file: `${routesDir}/${wmod}.v` })
						}
						const fns = parseVFile(src).filter((x) => x.attr !== 'before' && x.attr !== 'after')
						for (const l of parseVFile(src).filter((x) => x.attr === 'load'))
							loads.push({ ...l, mod: d.mod, file: `${routesDir}/${d.mod}.v` })
						// Chain validation: level 0 takes (req); deeper levels
						// take (req, parent T) where T is the previous level's
						// return (short or vType-prefixed spelling — same form
						// the inliner produces). Mismatch = build error
						// (the layout contract, enforced).
						{
							let want: string | null = null
							for (const l of loads) {
								validateLoadFn(l.file, l, want)
								// Next level's parent is THIS level's return,
								// vType-prefixed (codegen merges into one file).
								want = l.vret.includes('_') ? l.vret : vType(l.vret, l.mod)
							}
						}
						mkdirSync(routesGenDir, { recursive: true })
						writeFileSync(
							join(routesGenDir, `${vFileSafe(d.mod)}.v`),
							emitRouteFile(d.mod, d.route, d.prefix, src, fns, chain, loads)
						)
					}
					// Prune stale generated files (renamed/deleted routes).
					// Compare against the CURRENT naming (vFileSafe) — and drop
					// any legacy-named output (old `_x.v` flat stems) that no
					// current mod maps to, so stale files never shadow fresh ones.
					// Adapter-owned bridges (swelte_qjs_bridge.v) are NEVER
					// pruned: the adapter emits them between generate() runs
					// (generateBundle), core must not delete them. Core emits
					// only dispatched leaf files + server_gen.v — everything
					// else (bridges, manual shims) survives regeneration.
					const ADAPTER_OWNED = new Set(['swelte_qjs_bridge'])
					try {
						for (const f of readdirSync(routesGenDir)) {
							if (!f.endsWith('.v')) continue
							const stem = f.slice(0, -2)
							if (stem === 'server_gen') continue
							if (ADAPTER_OWNED.has(stem)) continue
							if (![...seenMods].some((m) => vFileSafe(m) === stem)) {
								try {
									rmSync(join(routesGenDir, f))
								} catch {
									/* ignore */
								}
							}
						}
					} catch {
						/* ignore */
					}
					// Master dispatcher: route table + shared helpers, also `module routes`.
					if (dispatched.length) {
						mkdirSync(routesGenDir, { recursive: true })
						const sseMods = new Set<string>()
						for (const f of routeFiles) {
							try {
								const mod = modulePath(routesAbs, f)
								if (parseVFile(readFileSync(f, 'utf8')).some((x) => x.attr === 'sse'))
									sseMods.add(mod)
							} catch {
								/* ignore */
							}
						}
						writeFileSync(join(routesGenDir, `server_gen.v`), emitServerGen(dispatched, sseMods))
					}
					// Leaf-vs-index clash: foo.v + foo/index.v (or +page.v) both exist.
					// Warn-only here (the hard build error lives in the per-file
					// loop above via doubleClaimCheck, which names both files).
					// Union of .v + .svelte mods: svelte-only leaves clash too.
					const seen = new Set([
						...listVFiles(routesAbs).map((f) => modulePath(routesAbs, f)),
						...listFilesWithExt(routesAbs, '.svelte').map((f) =>
							relPosix(routesAbs, f).replace(/\.svelte$/, '')
						),
					])
					for (const mod of seen) {
						for (const leafName of ['index', '+page']) {
							if (mod !== leafName && seen.has(`${mod}/${leafName}`)) {
								warnings.push(
									`${routesDir}/${mod}.v clashes with ${routesDir}/${mod}/${leafName}.v — ambiguous route`
								)
							}
						}
					}
				}
				if (existsSync(libAbs)) {
					// Backend runs purely on V: no .ts/.js/.svelte under backend/ (decided 2026-10-29).
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
							warnings.push(
								`${b}: backend/ runs purely on V — no TS/JS/Svelte here (move it out of backend/)`
							)
					}
					for (const f of listVFiles(libAbs)) {
						const src = readFileSync(f, 'utf8')
						const mod = modulePath(libAbs, f)
						// #lib/backend convention (spec §7): backend-only, no stub, no
						// browser import — record types for V-to-V reference only.
						if (isBackendMod(mod)) continue
						// Roadmap 16-remainder: only #routes/*.v may import backend.
						// A #lib/*.v (non-backend) file importing backend fails here
						// (generate-time, file+line) — the resolveId guard covers
						// browser-side imports; this covers V-to-V misuse that never
						// passes through resolveId.
						for (const b of backendImportLines(src)) {
							throw new Error(
								`[swelte] ${libDir}/${mod}.v:${b.line}: imports backend module '${b.imp}' — only #routes/*.v may import #lib/backend (V-to-V include at codegen time).`
							)
						}
						const rpcFns = parseVFile(src).filter((x) => x.attr === 'rpc')
						// §7: middleware/verbs are meaningless in #lib — keep the
						// warn-and-expose-RPC behavior for verbs, extend it to
						// @[before]/@[after].
						const verbFns = parseVFile(src).filter(
							(x) => x.attr !== 'rpc' && x.attr !== 'before' && x.attr !== 'after'
						)
						for (const vf of [
							...verbFns,
							...parseVFile(src).filter((x) => x.attr === 'before' || x.attr === 'after'),
						]) {
							warnings.push(
								`${libDir}/${mod}.v: @[${vf.attr}] on ${vf.name} is ignored in #lib — only @[rpc] exposes (still exported as RPC)`
							)
						}
						if (rpcFns.length === 0 && verbFns.length === 0) continue
						const allFns = [...rpcFns, ...verbFns]
						emitTypes('lib', mod, src, allFns)
						const genModDir = join(
							genDir,
							'generated',
							'lib',
							mod.split('/').slice(0, -1).join('/')
						)
						mkdirSync(genModDir, { recursive: true })
						writeFileSync(
							join(genModDir, mod.split('/').pop() + '.js'),
							jsWasmFor(isBuild, mod, allFns)
						)
						try {
							const outWasm = join(devWasmDirFor(root), mod + '.wasm')
							let fresh = false
							try {
								fresh = statSync(outWasm).mtimeMs >= statSync(f).mtimeMs
							} catch {
								/* missing */
							}
							if (!fresh) compileLibWasm(src, mod, outWasm, libDir + '/' + mod + '.v')
						} catch (e) {
							throw new Error('WASM compile failed: ' + (e as Error).message)
						}
					}
				}
				// Editor resolution (spec §4, roadmap §3): everything lives in
				// .swelte/ — src/ is never written. Two artifacts are ORDERED:
				// types/*.d.ts FIRST (emitTypes loop above), then this block
				// inlines those bodies into v-shim.d.ts (copies, since TS2686
				// forbids relative re-export inside ambient modules). The shim
				// therefore always lags the .d.ts by zero steps within one
				// generate() run — never read a stale file.
				// 2. tsconfig `paths` (STABLE wildcards, written once by hand in the
				//    user config — TS drops non-`*` exact keys from extended
				//    configs, so no fragment file):
				//      "#routes/*.v": ["./.swelte/types/routes/*.d.ts"]
				//      "#lib/*.v":    ["./.swelte/types/lib/*.d.ts"]
				//    TS matches `#routes/*.v` vs `#routes/index.v`, captures
				//    `index`, substitutes `./.swelte/types/routes/index.d.ts`.
				//    Vite runtime aliases (vite.config.ts) are independent and
				//    keep pointing at src/ (real .v for load() codegen).
				//
				// `declare module '*.v'` fallback stays last for unknown .v files.
				{
					const decls: string[] = ['// Auto-generated by swelte. Do not edit.', '']
					const bodies = new Map<string, string[]>()
					const collect = (sub: string, mod: string) => {
						const file = join(genDir, 'types', sub, `${mod}.d.ts`)
						let text = ''
						try {
							text = readFileSync(file, 'utf8')
						} catch {
							return
						}
						const lines = text.split('\n').filter((l) => {
							const t = l.trim()
							return t !== '' && !t.startsWith('// Auto-generated')
						})
						bodies.set(`${sub}/${mod}`, lines)
					}
					for (const f of listVFiles(routesAbs)) {
						const src = readFileSync(f, 'utf8')
						const fns = parseVFile(src)
						if (fns.length === 0) continue
						collect('routes', modulePath(routesAbs, f))
					}
					if (existsSync(libAbs)) {
						for (const f of listVFiles(libAbs)) {
							const mod = modulePath(libAbs, f)
							if (isBackendMod(mod)) continue
							const src = readFileSync(f, 'utf8')
							const fns = parseVFile(src)
							if (fns.length === 0) continue
							collect('lib', mod)
						}
					}
					const emit = (spec: string, sub: string, mod: string) => {
						const body = bodies.get(`${sub}/${mod}`)
						if (!body) return
						decls.push(`declare module '${spec}' {`)
						for (const l of body) decls.push(`\t${l}`)
						decls.push(`}`)
						decls.push('')
					}
					for (const key of [...bodies.keys()].filter((k) => k.startsWith('routes/'))) {
						emit(`#routes/${key.slice('routes/'.length)}.v`, 'routes', key.slice('routes/'.length))
					}
					for (const key of [...bodies.keys()].filter((k) => k.startsWith('lib/'))) {
						emit(`#lib/${key.slice('lib/'.length)}.v`, 'lib', key.slice('lib/'.length))
					}
					// Roadmap §17: exact-key `./<base>.v` aliases — only when the
					// basename is UNIQUE across the whole project (routes + lib).
					// Ambiguous basenames (`+page.v` ×3) and sub-path relatives
					// (`./sub/y.v`) keep the `*.v` fallback (any): use `#`-aliases.
					// Bodies inlined (TS2686 forbids re-export in ambient modules).
					{
						const baseCount = new Map<string, number>()
						const baseBody = new Map<string, { spec: string; sub: string; mod: string }>()
						for (const key of bodies.keys()) {
							const mod = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key
							const base = mod.includes('/') ? mod.slice(mod.lastIndexOf('/') + 1) : mod
							baseCount.set(base, (baseCount.get(base) ?? 0) + 1)
							const sub = key.startsWith('lib/') ? 'lib' : 'routes'
							const prefix = sub === 'lib' ? '#lib' : '#routes'
							if (!baseBody.has(base)) baseBody.set(base, { spec: `${prefix}/${mod}.v`, sub, mod })
						}
						for (const [base, n] of [...baseCount.entries()].sort()) {
							if (n !== 1) continue
							const b = baseBody.get(base)
							if (!b) continue
							const body = bodies.get(`${b.sub}/${b.mod}`)
							if (!body) continue
							decls.push(`declare module './${base}.v' {`)
							for (const l of body) decls.push(`\t${l}`)
							decls.push(`}`)
							decls.push('')
						}
					}
					decls.push(`// Fallback for unknown .v files only.
declare module '*.v' {
	const __swelte_untyped: any
	export default __swelte_untyped
}
`)
					writeFileSync(join(genDir, 'v-shim.d.ts'), decls.join('\n'))
				}
				for (const w of warnings) console.warn(`[swelte] ${w}`)
				// Roadmap 7: client router — UI composition without manual imports.
				// Emits `.swelte/routes.js`: real static imports of every page +
				// wrapper, a ROUTES array (path pattern, page, wrappers root→leaf),
				// and mountRoute() that matches location.pathname (static-first,
				// fewest-params-first — same precedence as the V dispatcher) and
				// nests the page inside its wrappers via `children` snippets.
				// main.ts mounts through it; unknown path → +error.svelte 404.
				try {
					const svelteOnly: { route: string; mod: string; wrappers: string[] }[] = []
					try {
						const { entries: svelteEntries } = collectSvelteManifest(routesAbs, routesDir, vMods)
						const dispMods = new Set(dispatched.map((d) => d.mod))
						for (const e of svelteEntries) {
							if (e.kind === 'wrapper' || e.kind === 'error') continue
							const mod = e.svelte.replace(/\.svelte$/, '')
							if (dispMods.has(mod)) continue // already covered by dispatched UI entry
							const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
							const wrappers: string[] = []
							let cur = dir
							for (;;) {
								const cand = (cur === '' ? '+route' : cur + '/+route') + '.svelte'
								if (existsSync(join(routesAbs, ...cand.split('/'))))
									wrappers.unshift(cand.replace(/\.svelte$/, ''))
								if (cur === '') break
								cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''
							}
							svelteOnly.push({ route: e.route, mod, wrappers })
						}
					} catch {
						/* svelte-only entries best-effort */
					}
					const entries: { route: string; mod: string; wrappers: string[] }[] = []
					for (const d of dispatched) {
						const pageFile = join(routesAbs, ...d.mod.split('/')) + '.svelte'
						if (!existsSync(pageFile)) continue // headless API route: no UI
						const dir = d.mod.includes('/') ? d.mod.slice(0, d.mod.lastIndexOf('/')) : ''
						const wrappers: string[] = []
						let cur = dir
						for (;;) {
							const cand = (cur === '' ? '+route' : cur + '/+route') + '.svelte'
							if (existsSync(join(routesAbs, ...cand.split('/'))))
								wrappers.unshift(cand.replace(/\.svelte$/, ''))
							if (cur === '') break
							cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''
						}
						entries.push({ route: d.route, mod: d.mod, wrappers })
					}
					for (const s of svelteOnly) entries.push(s)
					const rank = (p: string) => (p.includes('[') ? (p.includes('...') ? 2 : 1) : 0)
					entries.sort((a, b) => rank(a.route) - rank(b.route) || a.route.localeCompare(b.route))
					const o: string[] = ['// Auto-generated by swelte from src/routes. Do not edit.', '']
					const sym = (mod: string, suffix: string) =>
						'R_' + mod.replace(/[^A-Za-z0-9_]/g, '_') + suffix
					for (const e of entries) {
						o.push(`import ${sym(e.mod, '_Page')} from '../${routesDir}/${e.mod}.svelte'`)
						for (const w of e.wrappers)
							o.push(`import ${sym(w, '_Wrap')} from '../${routesDir}/${w}.svelte'`)
					}
					try {
						if (existsSync(join(routesAbs, '+error.svelte')))
							o.push(`import SwelteErrorPage from '../${routesDir}/+error.svelte'`)
					} catch {
						/* no error page */
					}
					o.push(`
import { mount, hydrate, createRawSnippet } from 'svelte'

function matchSegs(pattern, pathname) {
	const pat = pattern.split('/').filter((s) => s !== '')
	const got = pathname.split('/').filter((s) => s !== '')
	const params = {}
	let gi = 0
	for (let pi = 0; pi < pat.length; pi++) {
		const seg = pat[pi]
		if (seg.startsWith('[...') && seg.endsWith(']')) { params[seg.slice(4, -1)] = got.slice(gi).map(decodeURIComponent).join('/'); gi = got.length; break }
		if (seg.startsWith('[') && seg.endsWith(']')) { if (gi >= got.length || !got[gi]) return null; params[seg.slice(1, -1)] = decodeURIComponent(got[gi++]); continue }
		if (got[gi++] !== seg) return null
	}
	return gi === got.length ? params : null
}

export const ROUTES = [
`)
					for (const e of entries) {
						const wraps = e.wrappers.map((w) => sym(w, '_Wrap')).join(', ')
						o.push(
							`\t{ path: ${JSON.stringify(e.route)}, page: ${sym(e.mod, '_Page')}, wrappers: [${wraps}] },`
						)
					}
					o.push(`]

export function mountSwelteRoute(target, pathname, errorProps) {
	const path = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
	for (const r of ROUTES) {
		const params = matchSegs(r.path, path)
		if (!params) continue
		// Leaf-first: page mounts into host[0]; each wrapper mounts with \`children\`
		// as a Snippet appending the inner host — leaf renders inside wrapper
		// nav/chrome with no manual import in +page.svelte.
		const hosts = [document.createElement('div')]
		mount(r.page, { target: hosts[0], props: { params } })
		for (let i = r.wrappers.length - 1; i >= 0; i--) {
			const host = document.createElement('div')
			const inner = hosts[hosts.length - 1]
			const snip = createRawSnippet(() => ({ render: () => \`\`, setup: (el) => { el.appendChild(inner) } }))
			mount(r.wrappers[i], { target: host, props: { params, children: snip } })
			hosts.push(host)
		}
		target.appendChild(hosts[hosts.length - 1])
		return { params, path: r.path }
	}
	if (typeof SwelteErrorPage !== 'undefined') { mount(SwelteErrorPage, { target, props: errorProps ?? { status: 404, message: 'not found' } }); return { params: {}, path: null } }
	throw new Error('swelte: no route for ' + pathname)
}
`)
					o.push(`
// SSR hydrate path: when Hand fills <!--ssr-body-->
// the same component tree hydrates in place instead of mounting fresh.
// Falls back to mount on mismatch (SPA shell).
export function hydrateSwelteRoute(target, pathname, errorProps) {
	try {
		const path = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
		for (const r of ROUTES) {
			const params = matchSegs(r.path, path)
			if (!params) continue
			hydrate(r.page, { target, props: { params } })
			return { params, path: r.path, hydrated: true }
		}
		if (typeof SwelteErrorPage !== 'undefined') {
			hydrate(SwelteErrorPage, { target, props: errorProps ?? { status: 404, message: 'not found' } })
			return { params: {}, path: null, hydrated: true }
		}
	} catch { /* fall through to mount */ }
	return { ...mountSwelteRoute(target, pathname, errorProps), hydrated: false }
}
`)
					writeFileSync(join(genDir, 'routes.js'), o.join('\n'))
				} catch (e) {
					console.warn(`[swelte] routes.js emit failed: ${(e as Error).message}`)
				}
				// SSR manifest: engine-agnostic JSON for adapters.
				// [{ route, svelte, kind, hasData }] + hasError flag. Core emits it;
				// ssr-qjs/ssr-bun compose render.js from it. Never import engine deps.
				try {
					const { entries: svelteEntries, hasError } = collectSvelteManifest(
						routesAbs,
						routesDir,
						vMods
					)
					const manifest = {
						version: 1,
						hasError,
						routes: svelteEntries
							.filter((e) => e.kind !== 'wrapper' && e.kind !== 'error')
							.map((e) => ({
								route: e.route,
								svelte: e.svelte,
								kind: e.kind,
								hasData: e.hasData,
							}))
							.sort((a, b) => a.route.localeCompare(b.route)),
						error: svelteEntries.some((e) => e.kind === 'error')
							? (svelteEntries.find((e) => e.kind === 'error')?.svelte ?? null)
							: null,
						wrappers: svelteEntries
							.filter((e) => e.kind === 'wrapper')
							.map((e) => e.svelte)
							.sort(),
					}
					writeFileSync(join(genDir, 'ssr-manifest.json'), JSON.stringify(manifest, null, 2))
				} catch (e) {
					throw e
				}
				writeFileSync(join(genDir, 'sdk.ts'), '// Auto-generated by swelte. Do not edit.\n')
				// Server harness: verbatim skeleton from templates/ (node_modules),
				// rendered into `.swelte/server.v`. `dev`/`build` compile `.swelte/`
				// as one V unit (harness `module main` + `routes/` + `server_gen.v`).
				try {
					const cfg = await loadConfig(root)
					writeFileSync(join(genDir, 'server.v'), renderHarness(cfg, import.meta.url))
				} catch (e) {
					warnings.push(`harness: ${(e as Error).message}`)
				}
				// Client entry (engine-owned, like server.v):
				// templates/client/main.ts → .swelte/entry-main.ts.
				// transformIndexHtml below points the script tag at it;
				// src/main.ts stays a user-owned shim.
				try {
					writeFileSync(join(genDir, 'entry-main.ts'), renderClientEntry(root, import.meta.url))
				} catch (e) {
					warnings.push(`entry: ${(e as Error).message}`)
				}
			})()
		)
		genChain = run.catch(() => {})
		return run
	}

	return {
		name: 'swelte',
		// Run before vite-plugin-svelte so `.v` ids resolve before the
		// Svelte compiler requests them (Svelte emits relative `.v`
		// imports verbatim; our load() codegens the JS).
		enforce: 'pre',
		config(userConfig, env) {
			isBuild = (env as { command?: string } | undefined)?.command === 'build'
			// Resolve dirs against the Vite root (not process.cwd()) — the
			// language server loads vite.config.ts with cwd elsewhere.
			const root = (userConfig && (userConfig as { root?: string }).root) || process.cwd()
			const routesAbs = resolve(root, routesDir)
			const libAbs = resolve(root, libDir)
			return {
				resolve: {
					alias: [
						{ find: '#routes', replacement: routesAbs },
						{ find: '#lib', replacement: libAbs },
					],
				},
			}
		},
		configResolved(config) {
			activeRoot = config.root
			void generate(config.root).catch((e: Error) => {
				console.warn(`[swelte] generate skipped (${e.message})`)
			})
		},
		buildStart() {
			// Production builds must regenerate (configResolved may run in a
			// different context; never reuse a stale .swelte/ from dev).
			usedLibFiles.clear()
			return generate(activeRoot || process.cwd())
		},
		transformIndexHtml(html) {
			// Point the entry script at the generated client entry
			// (.swelte/entry-main.ts, engine-owned). src/main.ts remains a
			// user-owned shim for eject/custom setups — the framework never
			// requires editing it. Only rewrites the canonical /src/main.ts
			// reference; custom entries are left alone.
			let out = html
			if (out.includes('/src/main.ts')) {
				out = out.replaceAll('/src/main.ts', '/.swelte/entry-main.ts')
			}
			// SSR markers: Hand fills <!--ssr-head-->/<!--ssr-body--> when a
			// renderer answers. Inject them into the #app host when absent
			// (built dist/index.html has no markers — source app.html does).
			if (!out.includes('<!--ssr-body-->') && out.includes('<div id="app">')) {
				out = out.replace('<div id="app">', '<div id="app"><!--ssr-body-->')
			}
			if (!out.includes('<!--ssr-head-->') && out.includes('</head>')) {
				out = out.replace('</head>', '<!--ssr-head--></head>')
			}
			return out
		},
		async resolveId(source, importer, _opts) {
			if (!importer) return null
			// New: direct `.v` imports (spec §4). Resolve `#routes/x.v`,
			// `#lib/y.v`, and relative `./x.v` to absolute file paths under
			// the virtual prefix; load() codegens the stub.
			if (source.endsWith('.v')) {
				const ctxRoot = (this as unknown as { environment?: { config?: { root?: string } } })
					.environment?.config?.root
				// Prefer the root the plugin generated for (configResolved), then
				// the caller ctx, then cwd. Vite resolves #aliases against the
				// project root, which may differ from the resolveId ctx in tests.
				const candRoots = [
					activeRoot,
					ctxRoot,
					serverRoot() as string | null,
					process.cwd(),
				].filter(Boolean) as string[]
				let abs: string | null = null
				let root = candRoots[0]
				// Bare `.v` id (alias pre-resolved by Vite to an abs path) counts
				// too — the Svelte compiler emits the resolved path, not `#...`.
				const bareV =
					source.endsWith('.v') &&
					!source.startsWith('#') &&
					!source.startsWith('.') &&
					!source.startsWith('\0')
				for (const cand of candRoots) {
					const routesAbs = resolve(cand, routesDir)
					const libAbs = resolve(cand, libDir)
					let trial: string | null = null
					if (source.startsWith('#routes/'))
						trial = join(routesAbs, source.slice('#routes/'.length))
					else if (source.startsWith('#lib/')) trial = join(libAbs, source.slice('#lib/'.length))
					else if (source.startsWith('.')) {
						const dir = importer.split('?')[0].replace(/[/\\][^/\\]*$/, '')
						trial = resolve(dir, source)
					}
					if (!trial) continue
					const norm = trial.split(sep).join('/')
					const routesNorm = routesAbs.split(sep).join('/')
					const libNorm = libAbs.split(sep).join('/')
					const underRoutes = norm === routesNorm || norm.startsWith(`${routesNorm}/`)
					const underLib = norm === libNorm || norm.startsWith(`${libNorm}/`)
					if ((underRoutes || underLib) && existsSync(trial)) {
						abs = trial
						root = cand
						break
					}
					if (!abs && existsSync(trial)) {
						abs = trial
						root = cand
					}
				}
				// Alias pre-resolved: bare abs `/root/src/routes/x.v` — the Svelte
				// compiler emits the resolved path, not `#...`. No trial matched
				// above (source is neither #/./relative), so check directly.
				if (!abs && bareV) {
					for (const cand of candRoots) {
						const routesNorm = resolve(cand, routesDir).split(sep).join('/')
						const libNorm = resolve(cand, libDir).split(sep).join('/')
						const norm = source.split(sep).join('/')
						if (
							(norm === routesNorm ||
								norm.startsWith(`${routesNorm}/`) ||
								norm === libNorm ||
								norm.startsWith(`${libNorm}/`)) &&
							existsSync(source)
						) {
							abs = source
							root = cand
							break
						}
					}
				}
				if (!abs) return null
				const routesAbs = resolve(root, routesDir)
				const libAbs = resolve(root, libDir)
				const norm = abs.split(sep).join('/')
				const routesNorm = routesAbs.split(sep).join('/')
				const libNorm = libAbs.split(sep).join('/')
				const underRoutes = norm === routesNorm || norm.startsWith(`${routesNorm}/`)
				const underLib = norm === libNorm || norm.startsWith(`${libNorm}/`)
				if (!underRoutes && !underLib) return null
				// Tree-shaking record: this .v file is imported by client
				// code (or by another .v file — filtered to #lib/ at bundle
				// time). Dev artifacts compile in generate() regardless; the
				// prod bundle compiles only recorded files.
				usedLibFiles.add(abs)
				// #lib/backend convention (spec §7): backend-only — refuse from
				// client code with a loud error naming importer+file.
				// Roadmap 16-remainder: ONLY #routes/*.v may import backend
				// (V-to-V include at codegen time). A #lib/*.v importer is
				// also rejected — backend fns never enter the WASM bundle.
				if (underLib) {
					const rel = norm.slice(libNorm.length + 1)
					if (isBackendMod(rel)) {
						const impNorm = importer.split('?')[0].split(sep).join('/')
						const impUnderRoutes = impNorm === routesNorm || impNorm.startsWith(`${routesNorm}/`)
						if (!impUnderRoutes) {
							throw new Error(
								`[swelte] ${source} is backend-only (#lib/backend convention): ` +
									`imported by ${importer}. Only #routes/*.v may import #lib/backend (V-to-V include at codegen time). Move the fn or import it from a #routes/*.v file.`
							)
						}
					}
				}
				return `\0swelte:v:${abs}`
			}
			return null // legacy ./$types / self / $ssapi / $csapi removed — import the .v file.
		},
		async load(id) {
			// Codegen for direct `.v` imports (spec §4). The id is the virtual
			// `\0swelte:v:<abs path>` minted in resolveId above.
			if (!id.startsWith('\0swelte:v:')) return null
			const abs = id.slice('\0swelte:v:'.length).split('?')[0]
			const root = (serverRoot() as string | null) || activeRoot || process.cwd()
			const routesAbs = resolve(root, routesDir)
			const libAbs = resolve(root, libDir)
			const norm = abs.split(sep).join('/')
			const routesNorm = routesAbs.split(sep).join('/')
			const libNorm = libAbs.split(sep).join('/')
			let src: string
			try {
				src = readFileSync(abs, 'utf8')
			} catch {
				return null
			}
			if (norm === routesNorm || norm.startsWith(`${routesNorm}/`)) {
				// §7: middleware is server-only — strip it from the browser
				// stub (it has no client binding). +route.v wrappers expose
				// nothing: importing one from the browser is a build error.
				const route = routeFor(routesDir, routesAbs, abs)
				if (route === null) {
					throw new Error(
						`[swelte] ${abs} is a +route.v wrapper (@[before]/@[after] middleware only) and cannot be imported in browser code.`
					)
				}
				const fns = parseVFile(src).filter((x) => x.attr !== 'before' && x.attr !== 'after')
				if (fns.length === 0) return 'export {}; // swelte: no RPC fns in this .v file'
				return jsFetchFor(route, fns)
			}
			if (norm === libNorm || norm.startsWith(`${libNorm}/`)) {
				const mod = modulePath(libAbs, abs)
				if (isBackendMod(mod)) {
					throw new Error(
						`[swelte] ${abs} is backend-only (#lib/backend) and cannot be imported in browser code.`
					)
				}
				const rpcFns = parseVFile(src).filter((x) => x.attr === 'rpc')
				const verbFns = parseVFile(src).filter(
					(x) => x.attr !== 'rpc' && x.attr !== 'before' && x.attr !== 'after'
				)
				const allFns = [...rpcFns, ...verbFns]
				if (allFns.length === 0) return 'export {}; // swelte: no RPC fns in this .v file'
				return jsWasmFor(isBuild, mod, allFns)
			}
			return null
		},
		configureServer(server) {
			// Root-anchored (never cwd-relative): language-server and
			// non-cwd roots resolve through server.config.root.
			const root = server.config.root
			const watch = [resolve(root, routesDir), resolve(root, libDir)]
			server.watcher.add(watch)
			const regen = (file: string) => {
				if (!file.endsWith('.v')) return
				void generate(server.config.root).catch(() => {
					/* ignore */
				})
				try {
					// Roadmap 21: signature change must remount, not go stale.
					// The old path only covered #lib/; routes stubs
					// (\0swelte:v:<abs> for src/routes/**) were never
					// invalidated so the browser kept the old stub. The watcher
					// `file` IS the abs path resolveId stored, so invalidate
					// it directly + its importers (one level: the +page.svelte
					// that imported the stub) so Svelte remounts with the new
					// type — no restart, no stale stub.
					const virt = '\0swelte:v:' + file.split('?')[0]
					const m = server.moduleGraph.getModuleById(virt)
					if (m) {
						server.moduleGraph.invalidateModule(m)
						for (const imp of m.importers) server.moduleGraph.invalidateModule(imp)
					}
				} catch {
					/* HMR best-effort */
				}
			}
			server.watcher.on('add', regen)
			server.watcher.on('change', regen)
			server.watcher.on('unlink', regen)
			// Dev: serve .swelte/dev/<mod>.wasm micro-modules + proxy /
			// and /api/* RPC to the V backend when vBackendUrl is set.
			server.middlewares.use(
				async (
					req: IncomingMessage & { url?: string; method?: string },
					res: ServerResponse,
					next: () => void
				) => {
					try {
						const url = new URL(req.url ?? '/', 'http://localhost')
						if (url.pathname.startsWith('/@swelte-dev/') && url.pathname.endsWith('.wasm')) {
							const mod = url.pathname.slice('/@swelte-dev/'.length, -'.wasm'.length)
							const fp = join(devWasmDirFor(server.config.root), mod + '.wasm')
							if (existsSync(fp)) {
								const buf = readFileSync(fp)
								res.statusCode = 200
								res.setHeader('content-type', 'application/wasm')
								res.setHeader('cache-control', 'no-store')
								res.end(buf)
								return
							}
							return next()
						}
						if (!vBackendUrl) return next()
						{
							const isRpc = url.pathname === '/' || url.pathname.startsWith('/api/')
							if (!isRpc) return next()
							const accept = String(req.headers['accept'] ?? '')
							const ctype = String(req.headers['content-type'] ?? '')
							const isSelf = url.pathname === '/'
							// SPA first: browser page loads (GET + Accept: text/html,
							// no ?q=) are never RPC — let Vite serve index.html.
							// Only JSON GETs (Accept: application/json) and writes
							// (JSON body or form content-type) proxy.
							if (
								isSelf &&
								req.method === 'GET' &&
								!url.searchParams.has('q') &&
								!accept.includes('application/json')
							)
								return next()
							const looksRpc =
								ctype.includes('application/json') ||
								(req.method === 'GET' && accept.includes('application/json')) ||
								(req.method === 'GET' && accept.includes('text/event-stream')) ||
								ctype.includes('multipart/form-data') ||
								ctype.includes('application/x-www-form-urlencoded')
							if (!looksRpc) return next()
							const target = `${vBackendUrl}${url.pathname}${url.search}`
							const headers: Record<string, string> = {}
							for (const [k, v] of Object.entries(req.headers)) {
								if (v === undefined) continue
								if (k === 'host' || k === 'connection' || k === 'content-length') continue
								headers[k] = Array.isArray(v) ? v.join(', ') : String(v)
							}
							const chunks: Buffer[] = []
							await new Promise<void>((resolve) => {
								req.on('data', (c) => chunks.push(c as Buffer))
								req.on('end', () => resolve())
							})
							const body = Buffer.concat(chunks)
							const upstream = await fetch(target, {
								method: req.method,
								headers,
								body: body.length ? body : undefined,
							})
							res.statusCode = upstream.status
							upstream.headers.forEach((v, k) => {
								try {
									res.setHeader(k, v)
								} catch {
									/* ignore */
								}
							})
							// SSE passthrough (roadmap §14): stream the upstream body
							// chunk-by-chunk — never buffer it. `arrayBuffer()` would hold
							// every frame until the stream closes and the browser would see
							// all ticks at once. Non-SSE responses stay buffered (small JSON).
							if (accept.includes('text/event-stream') && upstream.body) {
								const reader = upstream.body.getReader()
								try {
									for (;;) {
										const { done, value } = await reader.read()
										if (value) res.write(Buffer.from(value))
										if (done) break
									}
								} finally {
									reader.releaseLock()
								}
								res.end()
								return
							}
							const buf = Buffer.from(await upstream.arrayBuffer())
							res.end(buf)
						}
					} catch {
						next()
					}
				}
			)
		},
		generateBundle(_opts, bundle) {
			const root = activeRoot || process.cwd()
			const libAbs = resolve(root, libDir)
			if (existsSync(libAbs)) {
				// Tree-shaking: only bundle #lib/ files actually imported
				// by client code (recorded in resolveId). Vite's own
				// tree-shaking then drops unused exports within them —
				// untouched helpers never enter the wasm.
				const usedNorm = (fp: string): string => resolve(fp).split(sep).join('/')
				const usedSet = new Set([...usedLibFiles].map(usedNorm))
				const mods: string[] = []
				const bodies: string[] = []
				for (const f of listVFiles(libAbs)) {
					if (!usedSet.has(usedNorm(f))) continue
					const mod = modulePath(libAbs, f)
					if (isBackendMod(mod)) continue
					const src = readFileSync(f, 'utf8')
					if (!parseVFile(src).some((x) => x.attr === 'rpc')) continue
					mods.push(mod)
					bodies.push(src)
				}
				if (mods.length > 0) {
					const seenFns = new Set<string>()
					const parts: string[] = []
					for (let i = 0; i < mods.length; i++) {
						const mod = mods[i]
						const src = bodies[i]
						for (const fn of parseVFile(src).filter((x) => x.attr === 'rpc')) {
							if (seenFns.has(fn.name))
								throw new Error('WASM bundle: duplicate fn ' + fn.name + ' (in ' + mod + '.v)')
							seenFns.add(fn.name)
							for (const p of fn.params) {
								if (wasmParamKind(p.vtype) === null)
									throw new Error(libDir + '/' + mod + '.v: ' + fn.name + ' unsupported param')
							}
							if (fn.fallible)
								throw new Error(libDir + '/' + mod + '.v: ' + fn.name + ' is fallible')
							if (wasmReturnKind(fn.vret) === null)
								throw new Error(libDir + '/' + mod + '.v: ' + fn.name + ' unsupported return')
						}
						const blocked = wasmBlockedImports(src)
						if (blocked.length > 0)
							throw new Error(libDir + '/' + mod + '.v: blocked import(s): ' + blocked.join(', '))
						const broken = [
							...new Set(
								[...src.matchAll(/^\s*import\s+([^\n;]+)/gm)]
									.flatMap((m) => m[1].split(','))
									.map((p) => p.trim().split(/\s+/).pop() as string)
									.map((mm) => mm.split('.')[0])
									.filter((top) => WASM_KNOWN_BROKEN.has(top))
							),
						]
						if (broken.length > 0)
							throw new Error(
								libDir +
									'/' +
									mod +
									'.v: uses known-broken wasm stdlib (' +
									broken.join(', ') +
									') — V 0.5.2 backend limitation'
							)
						parts.push(
							src
								.replace(/^\s*module\s+\S+.*$/m, '')
								.replace(/@\[([^\]]*)\]\s*/g, (_m, attrs: string) => {
									const keep = attrs
										.split(';')
										.map((a: string) => a.trim())
										.filter((a: string) => a && !/^(rpc|get|post|put|delete|patch|sse)\b/.test(a))
									return keep.length > 0 ? '@[' + keep.join('; ') + '] ' : ''
								})
						)
					}
					const entry = [
						`module main

@[export: 'swelte_alloc']
pub fn swelte_alloc(n int) &u8 {
	return unsafe { malloc(if n <= 0 { 1 } else { n }) }
}
`,
						...parts,
					].join('\n')
					const tmpEntry = join(resolve(root, outDir), '.bundle.compile.v')
					writeFileSync(tmpEntry, entry)
					try {
						const tmpWasm = join(resolve(root, outDir), '.' + prodWasmName)
						if (!vBin) vBin = resolveV(import.meta.url)
						execVSync(vBin, ['-b', 'wasm', '-os', 'browser', '-o', tmpWasm, tmpEntry], {
							stdio: ['ignore', 'pipe', 'pipe'],
						})
						const bytes = readFileSync(tmpWasm)
						const ref = this.emitFile({ type: 'asset', name: prodWasmName, source: bytes })
						const fileName = this.getFileName(ref)
						for (const [id, info] of Object.entries(bundle)) {
							if (
								id.endsWith('.js') &&
								info.type === 'chunk' &&
								info.code.includes('/assets/' + prodWasmName)
							) {
								info.code = info.code.split('/assets/' + prodWasmName).join('/' + fileName)
							}
						}
						try {
							rmSync(tmpWasm)
						} catch {
							/* ignore */
						}
					} finally {
						try {
							rmSync(tmpEntry)
						} catch {
							/* ignore */
						}
					}
				}
			}
			void _opts
			void bundle
		},
	}
}

export default swelte
