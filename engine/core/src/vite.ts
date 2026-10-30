import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFileSync as execVSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { resolveV } from './toolchain.js'

// Lazy V binary for `v -b wasm` (resolved on first compile).
// (module import must not throw when the caller passes a plain path).
let vBin = ''

const _createRequire = createRequire
void _createRequire
void dirname
void execVSync
void vBin
void resolveV

export interface SweltePluginOptions {
	routesDir?: string
	libDir?: string
	outDir?: string
	/** V backend base URL for dev RPC proxy (e.g. http://localhost:8131).
	 * Falls back to SWELTE_V_BACKEND_URL (injected by `swelte dev`). Unset = no proxy. */
	vBackendUrl?: string
}

interface RpcParam {
	name: string
	vtype: string
	tstype: string
	optional: boolean
}

interface RpcFn {
	name: string
	attr: 'get' | 'post' | 'rpc' | 'put' | 'delete' | 'patch'
	qualifier?: string
	params: RpcParam[]
	vret: string
	tsret: string
	fallible: boolean
	singleArgsStruct?: string
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
	const re =
		/@\[([^\]]*)\]\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*([?!]?[A-Za-z_\][\w.[\]]*|\([^)]*\))?/g
	let m: RegExpExecArray | null
	while ((m = re.exec(src)) !== null) {
		const attrParts = splitTopLevel(m[1], ';')
		const verbs: { verb: string; qualifier?: string }[] = []
		for (const p of attrParts) {
			const pm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\))?\s*$/.exec(p)
			if (pm && ['get', 'post', 'rpc', 'put', 'delete', 'patch'].includes(pm[1])) {
				verbs.push({ verb: pm[1], qualifier: pm[2] })
			}
		}
		if (verbs.length === 0) continue
		const name = m[2]
		const rawParams = (m[3] ?? '').trim()
		const rawRet = (m[4] ?? '').trim()
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
			})
		}
	}
	return fns
}

function listVFiles(dir: string, base?: string): string[] {
	if (!existsSync(dir)) return []
	const root = base ?? dir
	const out: string[] = []
	for (const e of readdirSync(dir)) {
		const p = join(dir, e)
		const st = statSync(p)
		// Never scan our own output: the generated `routes/` dispatcher dir
		// (sibling of server.v) plus anything under `.swelte/`.
		const rel = relative(root, p).split(sep).join('/')
		if (st.isDirectory()) {
			if (rel === 'routes' || rel.startsWith('routes/')) continue
			if (rel === '.swelte' || rel.startsWith('.swelte/')) continue
			out.push(...listVFiles(p, root))
		} else if (e.endsWith('.v')) out.push(p)
	}
	return out
}

/** Backend-only test (decided 2026-10-29): `backend/` dir segment at any
 * depth, or V-native `_backend.v` suffix (single-file exception without
 * moving the file). Backend runs purely on V — no `.ts`/`.js`/`.svelte`
 * under `backend/` (enforced in generate()). */
function isBackendMod(mod: string): boolean {
	const parts = mod.split('/')
	if (parts.includes('backend')) return true
	const stem = (parts.pop() ?? '').replace(/\.v$/, '')
	return stem.endsWith('_backend')
}

function modulePath(root: string, file: string): string {
	return relative(root, file).replace(/\.v$/, '').split(sep).join('/')
}

function tsTypeFor(vType: string): string {
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
	if (t.startsWith('map\\[')) return 'Record<string, unknown>'
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

interface VStruct {
	name: string
	fields: { name: string; vtype: string; tstype: string; optional: boolean }[]
}

function parseStructs(src: string): VStruct[] {
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

function pascal(s: string): string {
	return s
		.split('_')
		.map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
		.join('')
}

export function swelte(options: SweltePluginOptions = {}): Plugin {
	const routesDir = options.routesDir ?? 'src/routes'
	const libDir = options.libDir ?? 'src/lib'
	const outDir = options.outDir ?? '.swelte'
	const devWasmDir = join(outDir, 'dev')
	const prodWasmName = 'app_lib.wasm'
	let activeRoot = ''
	let isBuild = false
	// Roadmap §6 tree-shaking: every .v import resolved through the plugin
	// is recorded here (abs path → same). generateBundle compiles only the
	// recorded client-used #lib/ files — untouched helpers never enter
	// the prod wasm. Reset per build (buildStart) so dev/test resolutions
	// never leak into a bundle.
	const usedLibFiles = new Set<string>()
	const vBackendUrl =
		options.vBackendUrl ??
		process.env.SWELTE_V_BACKEND_URL ??
		process.env.VITE_SWELTE_V_BACKEND_URL
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
				if (top === 'os' || top === 'net' || top === 'db' || top === 'time' || top === 'v' || top === 'wasm' || top === 'x') {
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
		if (t === 'int' || t === 'i8' || t === 'i16' || t === 'i32' || t === 'u8' || t === 'u16' || t === 'u32' || t === 'rune' || t === 'char') return 'int'
		return null
	}

	function wasmReturnKind(vtype: string): string | null {
		const t = vtype.trim()
		if (t === '' || t === 'void') return 'void'
		if (t === 'string') return 'string'
		if (t === 'bool') return 'bool'
		if (t === 'int' || t === 'i8' || t === 'i16' || t === 'i32' || t === 'u8' || t === 'u16' || t === 'u32' || t === 'rune' || t === 'char') return 'int'
		return null
	}

	function compileLibWasm(src: string, mod: string, outWasm: string, libRel: string): number {
		const fns = parseVFile(src).filter((x) => x.attr === 'rpc')
		for (const f of fns) {
			for (const p of f.params) {
				if (wasmParamKind(p.vtype) === null) {
					throw new Error(libRel + ': ' + f.name + '(' + p.name + ': ' + p.vtype + ') cannot cross the WASM boundary')
				}
			}
			if (f.fallible) throw new Error(libRel + ': ' + f.name + ' is fallible — the V wasm backend cannot compile !T/?T (compiler ICE)')
			if (wasmReturnKind(f.vret) === null) throw new Error(libRel + ': ' + f.name + ' returns ' + (f.vret || '(unparsed)'))
		}
		const blocked = wasmBlockedImports(src)
		if (blocked.length > 0) throw new Error(libRel + ': blocked import(s): ' + blocked.join(', '))
		const broken = [...new Set(
			[...src.matchAll(/^\s*import\s+([^\n;]+)/gm)]
				.flatMap((m) => m[1].split(','))
				.map((p) => p.trim().split(/\s+/).pop() as string)
				.map((mm) => mm.split('.')[0])
				.filter((top) => WASM_KNOWN_BROKEN.has(top))
		)]
		if (broken.length > 0) throw new Error(libRel + ': uses known-broken wasm stdlib (' + broken.join(', ') + ') — V 0.5.2 backend limitation')
		const body = src
			.replace(/^\s*module\s+\S+.*$/m, 'module main')
			.replace(/@\[([^\]]*)\]\s*/g, (_mm, attrs: string) => {
				const keep = attrs.split(';').map((a: string) => a.trim()).filter((a: string) => a && !/^(rpc|get|post|put|delete|patch)\b/.test(a))
				return keep.length > 0 ? '@[' + keep.join('; ') + '] ' : ''
			})
		const compiled = [
			'module main',
			'',
			"@[export: 'swelte_alloc']",
			'pub fn swelte_alloc(n int) &u8 {',
			'\treturn unsafe { malloc(if n <= 0 { 1 } else { n }) }',
			'}',
			'',
			...body.split('\n').filter((l) => !/^\s*module\s+\S+/.test(l)),
		].join('\n')
		mkdirSync(dirname(outWasm), { recursive: true })
		const tmp = join(dirname(outWasm), '.compile.v')
		writeFileSync(tmp, compiled)
		try {
			if (!vBin) vBin = resolveV(import.meta.url)
			execVSync(vBin, ['-b', 'wasm', '-os', 'browser', '-o', outWasm, tmp], { stdio: ['ignore', 'pipe', 'pipe'] })
			const size = statSync(outWasm).size
			return size
		} finally {
			try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
		}
	}

	/** Map a routes file to its URL path (spec v-imports.md §2). */
	function routeFor(routesAbs: string, file: string): string {
		const mod = modulePath(routesAbs, file)
		if (mod === 'index' || mod.endsWith('/index')) {
			const base = mod === 'index' ? '' : mod.slice(0, -'/index'.length)
			return base === '' || base === 'api' ? '/' : `/${base}`
		}
		return `/${mod}`
	}

	function vJsonStr(s: string): string {
		return JSON.stringify(s)
	}

	function vPrefix(mod: string): string {
		return 'swelte_' + mod.replace(/[^A-Za-z0-9_]/g, '_')
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

	function emitServerGen(dispatched: { route: string; mod: string; prefix: string }[]): string {
		const o: string[] = []
		o.push('// Auto-generated by swelte from V signatures. Do not edit.')
		o.push('module routes')
		o.push('')
		o.push('import json')
		o.push('')
		o.push('pub struct SwelteRequest {')
		o.push('pub mut:')
		o.push('\tquery map[string]string')
		o.push('\tform map[string]string')
		o.push('\theaders map[string]string')
		o.push('\tcookies map[string]string')
		o.push('\tmethod string')
		o.push('\tpath string')
		o.push('\tqualifier string')
		o.push('}')
		o.push('')
		o.push('fn swelte_err_unknown(path string, fn_name string, available []string) (int, string) {')
		o.push("\tmut avail := '['")
		o.push('\tfor i, a in available {')
		o.push("\t\tif i > 0 { avail += ',' }")
		o.push('\t\tavail += json.encode(a)')
		o.push('\t}')
		o.push("\tavail += ']'")
		o.push('\treturn 404, \'{"error":"unknown fn","fn":\' + json.encode(fn_name) + \',"path":\' + json.encode(path) + \',"available":\' + avail + \'}\'')
		o.push('}')
		o.push('')
		o.push('fn swelte_err_bad(path string, fn_name string, detail string) (int, string) {')
		o.push('\treturn 400, \'{"error":\' + json.encode(detail) + \',"fn":\' + json.encode(fn_name) + \',"path":\' + json.encode(path) + \'}\'')
		o.push('}')
		o.push('')
		o.push('fn swelte_err_unknown_qual(path string, available []string) (int, string) {')
		o.push('\tmut avail := \'[\'')
		o.push('\tfor i, a in available {')
		o.push("\t\tif i > 0 { avail += ',' }")
		o.push('\t\tavail += json.encode(a)')
		o.push('\t}')
		o.push("\tavail += ']'")
		o.push('\treturn 404, \'{"error":"unknown qualifier","path":\' + json.encode(path) + \',"available":\' + avail + \'}\'')
		o.push('}')
		o.push('')
		o.push('pub fn swelte_route(path string, method string, query map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string) (int, string) {')
		for (const d of dispatched) {
			o.push(`\tif path == ${vJsonStr(d.route)} { return ${d.prefix}dispatch(path, method, query, headers, cookies, body, content_type, qualifier) }`)
		}
		o.push(`\treturn 404, '{"error":"not found"}'`)
		o.push('}')
		o.push('')
		return o.join('\n')
	}

	function emitRouteFile(mod: string, route: string, prefix: string, src: string, fns: RpcFn[]): string {
		const o: string[] = []
		o.push('// Auto-generated by swelte from V signatures. Do not edit.')
		o.push(`// Route: ${route} <- ${mod}.v`)
		o.push('module routes')
		o.push('')
		const needRpc = fns.some((f) => f.attr === 'rpc')
		const needVerb = fns.some((f) => f.attr !== 'rpc')
		// Only what this file's dispatch branch uses: rpc -> json+json2,
		// verbs -> json+http. Never emit an unused import (V warns).
		o.push('import json')
		if (needRpc) o.push('import x.json2')
		if (needVerb) o.push('import net.http')
		o.push('')
		const seenImp = new Set<string>()
		for (const m of src.matchAll(/^\s*import\s+(.+)$/gm)) {
			const imp = m[1].trim()
			const first = imp.split(/[\s,]/)[0]
			if (!imp || first === 'routes' || first === 'json' || first === 'x.json2' || first === 'net.http' || seenImp.has(imp)) continue
			seenImp.add(imp)
			o.push(`import ${imp}`)
		}
		if (seenImp.size) o.push('')
		// Shared structs: prefix to avoid duplicate-definition collisions
		// when several per-file outputs share `module routes`.
		const structNames = new Set(parseStructs(src).map((s) => s.name))
		for (const line of src.split('\n')) {
			const t = line.trim()
			if (/^module\s+\S+/.test(t)) continue
			if (/^\s*import\s+/.test(line)) continue
			let out = line.replace(/^(\s*)pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/, `$1pub fn ${prefix}$2`)
				out = out.replace(/^(\s*)(pub\s+struct\s+)([A-Za-z_][A-Za-z0-9_]*)/, (mm: string, sp: string, kw: string, nm: string) => `${sp}${kw}${(structNames as Set<string>).has(nm) ? vType(nm, mod) : prefix + nm}`)
			out = out.replace(/^(\s*)struct\s+([A-Za-z_][A-Za-z0-9_]*)/, `$1struct ${prefix}$2`)
			for (const sn of structNames) {
				if (new RegExp(`^\\s*(pub\\s+)?struct\\s+${sn}\\b`).test(t)) continue
				out = out.replace(new RegExp(`\\b${sn}\\b`, 'g'), vType(sn, mod))
			}
			o.push(out)
		}
		o.push('')
		o.push(`pub fn ${prefix}dispatch(path string, method string, query map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string) (int, string) {`)
		const rpcFns = fns.filter((f) => f.attr === 'rpc')
		if (rpcFns.length) {
			const avail = '[' + rpcFns.map((f) => vJsonStr(f.name)).join(', ') + ']'
			o.push(`\tif method == 'POST' && (content_type.contains('application/json') || content_type == '') {`)
			o.push(`\t\tparsed := json2.decode[map[string]json2.Any](body) or {`)
			o.push(`\t\t\treturn swelte_err_bad(path, '', 'bad json body')`)
			o.push(`\t\t}`)
			o.push(`\t\tfn_any := parsed['fn'] or {`)
			o.push(`\t\t\treturn swelte_err_bad(path, '', 'missing fn')`)
			o.push(`\t\t}`)
			o.push(`\t\tfn_name := fn_any.str().trim('"')`)
			o.push(`\t\targs_any := parsed['args'] or { json2.Any(json2.null) }`)
			o.push(`\t\targs_json := json2.encode(args_any)`)
			for (const fn of rpcFns) {
				const rs = fn.singleArgsStruct ? vType(fn.singleArgsStruct, mod) : null
				const dec = rs ? `json.decode(${rs}, args_json) or { return swelte_err_bad(path, fn_name, 'bad args') }` : `args_json`
				const call = `${prefix}${fn.name}(${dec})`
				o.push(`\t\tif fn_name == ${vJsonStr(fn.name)} {`)
				if (fn.fallible) {
					o.push(`\t\t\tres := ${call} or { return swelte_err_bad(path, fn_name, err.msg()) }`)
					o.push(fn.vret === 'void' ? `\t\t\treturn 200, '{}'` : `\t\t\treturn 200, json.encode(res)`)
				} else if (fn.vret === 'void') {
					o.push(`\t\t\t${call}`)
					o.push(`\t\t\treturn 200, '{}'`)
				} else {
					o.push(`\t\t\treturn 200, json.encode(${call})`)
				}
				o.push(`\t\t}`)
			}
			o.push(`\t\tif fn_name == '' {`)
			o.push(`\t\t\treturn swelte_err_bad(path, fn_name, 'missing fn')`)
			o.push(`\t\t}`)
			o.push(`\t\treturn swelte_err_unknown(path, fn_name, ${avail})`)
			o.push(`\t}`)
		}
		for (const vb of ['get', 'post', 'put', 'delete', 'patch']) {
			const hs = fns.filter((f) => f.attr === vb)
			if (!hs.length) continue
			const quals = hs.filter((h) => h.qualifier).map((h) => h.qualifier as string)
			o.push(`\tif method == '${vb.toUpperCase()}' {`)
			o.push(`\t\tmut form := map[string]string{}`)
			o.push(`\t\tif content_type.contains('multipart/form-data') {`)
			o.push(`\t\t\tmut boundary := ''`)
			o.push(`\t\t\tfor part in content_type.split(';') {`)
			o.push(`\t\t\t\tp := part.trim_space()`)
			o.push(`\t\t\t\tif p.starts_with('boundary=') { boundary = p.all_after('boundary=').trim('"') }`)
			o.push(`\t\t\t}`)
			o.push(`\t\t\tif boundary != '' { form, _ = http.parse_multipart_form(body, boundary) }`)
			o.push(`\t\t} else if content_type.contains('application/x-www-form-urlencoded') || body != '' {`)
			o.push(`\t\t\tform = http.parse_form(body)`)
			o.push(`\t\t}`)
			o.push(`\t\treq := SwelteRequest{ query: query, form: form, headers: headers, cookies: cookies, method: '${vb.toUpperCase()}', path: path, qualifier: qualifier }`)
			for (const h of hs) {
				const cond = h.qualifier ? `qualifier == ${vJsonStr(h.qualifier)}` : `qualifier == ''`
				const isReq = h.params.length === 1 && h.params[0].vtype === 'SwelteRequest'
				const call = isReq ? `${prefix}${h.name}(req)` : `${prefix}${h.name}(${h.params.map((p) => `req.form['${p.name}'] or { req.query['${p.name}'] or { '' } }`).join(', ')})`
				o.push(`\t\tif ${cond} {`)
				if (h.fallible) {
					o.push(`\t\t\tres := ${call} or { return swelte_err_bad(path, ${vJsonStr(h.name)}, err.msg()) }`)
					o.push(h.vret === 'void' ? `\t\t\treturn 200, '{}'` : `\t\t\treturn 200, json.encode(res)`)
				} else if (h.vret === 'void') {
					o.push(`\t\t\t${call}`)
					o.push(`\t\t\treturn 200, '{}'`)
				} else {
					o.push(`\t\t\treturn 200, json.encode(${call})`)
				}
				o.push(`\t\t}`)
			}
			if (quals.length) {
				o.push(`\t\treturn swelte_err_unknown_qual(path, [${quals.map((q) => vJsonStr(q)).join(', ')}])`)
			} else {
				o.push(`\t\treturn swelte_err_bad(path, '', 'missing qualifier')`)
			}
			o.push(`\t}`)
		}
		o.push(`\treturn 405, '{"error":"method not allowed"}'`)
		o.push('}')
		o.push('')
		return o.join('\n')
	}

	/** Codegen: fetch stub for a `#routes/*.v` file. */
	function jsFetchFor(route: string, fns: RpcFn[]): string {
		const lines = [
			'// Auto-generated by swelte from V signatures. Do not edit.',
			`import { __swelteFetch } from '@swelte/core';`,
			'',
		]
		for (const fn of fns) {
			// Verb handlers: server builds SwelteRequest from the HTTP
			// exchange. Optional client args become query/form fields.
			// @[rpc] fns send {fn,args} in the JSON body. Same stub
			// shape — kind decides. (`args = {}`: plain JS, no TS syntax —
			// stubs must parse as JS for non-TS consumers.)
			lines.push(`export function ${fn.name}(args = {}) {`)
			lines.push(
				`  return __swelteFetch(${JSON.stringify(route)}, ${JSON.stringify(fn.name)}, ${JSON.stringify(fn.attr)}, args, ${JSON.stringify(fn.qualifier ?? '')});`
			)
			lines.push('}')
			lines.push('')
		}
		return lines.join('\n')
	}

	/** Codegen: WASM stub for a `#lib/*.v` file. */
	function jsWasmFor(_root: string, mod: string, fns: RpcFn[]): string {
		const wasmUrl = isBuild ? '/assets/app_lib.wasm' : '/@swelte-dev/' + mod + '.wasm'
		const lines = [
			'// Auto-generated by swelte from ' + mod + '.v — do not edit.',
			"import { __swelteWasmCall } from '@swelte/core';",
			'const wasmUrl = ' + JSON.stringify(wasmUrl) + ';',
			'',
		]
		for (const fn of fns) {
			const params = JSON.stringify(fn.params.map((p) => ({ name: p.name, kind: wasmParamKind(p.vtype) || 'unsupported', vtype: p.vtype })))
			const ret = JSON.stringify(wasmReturnKind(fn.vret) || 'unsupported')
			lines.push('const ' + fn.name + '_params = ' + params + ';')
			lines.push('export function ' + fn.name + '(args) {')
			lines.push("  return __swelteWasmCall(wasmUrl, 'main." + fn.name + "', args, " + fn.name + '_params, ' + ret + ');')
			lines.push('}')
			lines.push('')
		}
		return lines.join('\n')
	}

	function generate(root: string) {
		const genDir = resolve(root, outDir)
		const typesDir = join(genDir, 'types')
		mkdirSync(genDir, { recursive: true })
		mkdirSync(typesDir, { recursive: true })
		const warnings: string[] = []
		const dispatched: { route: string; mod: string; prefix: string }[] = []

		function vSafe(mod: string): string {
			return mod.replace(/[^A-Za-z0-9_]/g, '_')
		}

		function emitTypes(sub: string, mod: string, src: string, fns: RpcFn[]): string {
			const dir = join(typesDir, sub, mod.split('/').slice(0, -1).join('/'))
			mkdirSync(dir, { recursive: true })
			const base = mod.split('/').pop() || 'index'
			const file = join(dir, `${base}.d.ts`)
			const out: string[] = ['// Auto-generated by swelte from V signatures. Do not edit.', '']
			if (fns.some((f) => f.attr !== 'rpc')) {
				out.push('export interface SwelteRequest {')
				out.push('  query: Record<string, string>;')
				out.push('  form: Record<string, string>;')
				out.push('  headers: Record<string, string>;')
				out.push('  cookies: Record<string, string>;')
				out.push('  method: string;')
				out.push('  path: string;')
				out.push('  qualifier: string;')
				out.push('}')
				out.push('')
			}
			for (const st of parseStructs(src)) {
				out.push(`export interface ${st.name} {`)
				for (const fld of st.fields) {
					if (fld.tstype === 'unknown')
						warnings.push(
							`${sub}/${mod}.${st.name}.${fld.name}: unknown V type '${fld.vtype}' → unknown`
						)
					out.push(`  ${fld.name}${fld.optional ? '?' : ''}: ${fld.tstype}; // ${fld.vtype}`)
				}
				out.push('}')
				out.push('')
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
					const ret = fn.tsret === 'void' ? 'void' : fn.tsret
					if (fn.tsret === 'unknown' && fn.vret !== 'unknown')
						warnings.push(`${sub}/${mod}.${fn.name} return: unknown V type '${fn.vret}' → unknown`)
					const Res = `${pascal(fn.name)}Result`
					if (/^[A-Z][A-Za-z0-9_]*$/.test(fn.vret)) {
						out.push(
							`export type ${Res} = ${fn.vret};${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
						)
					} else if (
						/^[a-z][A-Za-z0-9_]*$/.test(fn.vret) &&
						fn.vret !== 'void' &&
						fn.vret !== 'string' &&
						fn.vret !== 'number' &&
						fn.vret !== 'boolean'
					) {
						out.push(`// ${fn.name} returns V builtin ${fn.vret} (see above).`)
						out.push(`export type ${Res} = unknown;`)
					} else {
						out.push(
							`export type ${Res} = ${ret};${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
						)
					}
					if (!isReq && fn.params.length && !(fn.params.length === 1 && fn.params[0].name === 'req')) {
						out.push(`export interface ${pascal(fn.name)}Args {`)
						for (const p of fn.params) {
							if (p.tstype === 'unknown')
								warnings.push(
									`${sub}/${mod}.${fn.name} param ${p.name}: unknown V type '${p.vtype}' → unknown`
								)
							out.push(`  ${p.name}${p.optional ? '?' : ''}: ${p.tstype};`)
						}
						out.push('}')
						out.push(
							`export function ${fn.name}(args: ${pascal(fn.name)}Args): Promise<${Res}>;`
						)
					} else if (isReq) {
						out.push(`export function ${fn.name}(args?: Record<string, string>): Promise<${Res}>;`)
					} else {
						out.push(`// ${fn.name} takes no args (verb handler without params).`)
						out.push(`export function ${fn.name}(): Promise<${Res}>;`)
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
						out.push(`  ${p.name}${p.optional ? '?' : ''}: ${p.tstype};`)
					}
					out.push('}')
				} else {
					out.push(`// ${fn.name} args: see interface ${Arg} above (V single-args-struct).`)
				}
				const ret = fn.tsret === 'void' ? 'void' : fn.tsret
				if (fn.tsret === 'unknown' && fn.vret !== 'unknown')
					warnings.push(`${sub}/${mod}.${fn.name} return: unknown V type '${fn.vret}' → unknown`)
				const Res = `${pascal(fn.name)}Result`
				if (/^[A-Z][A-Za-z0-9_]*$/.test(fn.vret)) {
					out.push(
						`export type ${Res} = ${fn.vret};${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
					)
				} else if (
					/^[a-z][A-Za-z0-9_]*$/.test(fn.vret) &&
					fn.vret !== 'void' &&
					fn.vret !== 'string' &&
					fn.vret !== 'number' &&
					fn.vret !== 'boolean'
				) {
					out.push(`// ${fn.name} returns V builtin ${fn.vret} (see above).`)
					out.push(`export type ${Res} = unknown;`)
				} else {
					out.push(
						`export type ${Res} = ${ret};${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
					)
				}
				// Value signature: `import { fn } from '#…/x.v'` typechecks without a value shim.
				// Args are always the single args-struct (or the synthesized Args interface).
				out.push(`export function ${fn.name}(args: ${Arg}): Promise<${Res}>;`)
				out.push('')
			}
			writeFileSync(file, out.join('\n'))
			return file
		}

		// Layout (spec v-imports.md §2): routes → server fetch stubs,
		// lib → isomorphic WASM stubs. Types land under types/routes|lib so
		// the *.v resolveId/load below can re-export them 1:1.
		const routesAbs = resolve(root, routesDir)
		const libAbs = resolve(root, libDir)
		{
			for (const f of listVFiles(routesAbs)) {
				const src = readFileSync(f, 'utf8')
				const fns = parseVFile(src)
				const rpcFns = fns.filter((x) => x.attr === 'rpc')
				const verbFns = fns.filter((x) => x.attr !== 'rpc')
				const mod = modulePath(routesAbs, f)
				// Orphan/leaf-index checks (spec §2): warn, don't fail.
				if (mod !== 'index' && !mod.startsWith('api/')) {
					const sveltePartner = join(routesAbs, `${mod}.svelte`)
					const svelteIndex = join(routesAbs, mod, 'index.svelte')
					if (!existsSync(sveltePartner) && !existsSync(svelteIndex)) {
						warnings.push(
							`${routesDir}/${mod}.v: no .svelte partner (page) and not under api/ — orphan route file`
						)
					}
				}
				if (rpcFns.length === 0 && verbFns.length === 0) continue
				// One-default-per-verb + unique qualifier: build error
				// (ambiguous routing — roadmap item 15).
				for (const vb of ['get', 'post', 'put', 'delete', 'patch']) {
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
				emitTypes('routes', mod, src, fns)
				dispatched.push({ route: routeFor(routesAbs, f), mod, prefix: `${vPrefix(mod)}_` })
				// Runtime fetch stub for the browser import (dev + build).
				const genModDir = join(genDir, 'generated', 'routes', mod.split('/').slice(0, -1).join('/'))
				mkdirSync(genModDir, { recursive: true })
				writeFileSync(
					join(genModDir, `${mod.split('/').pop()}.js`),
					jsFetchFor(routeFor(routesAbs, f), fns)
				)
			}
			// Per-file dispatchers (roadmap item 1): one `module routes`
			// file per routes file, sharing directory-mode `v run` with
			// server.v (V requires directory name == module name).
			const routesGenDir = resolve(root, 'routes')
			// Track stale per-file outputs by rewriting the whole dir.
			try {
				readdirSync(routesGenDir)
			} catch {
				/* created below when needed */
			}
			const seenMods = new Set<string>()
			for (const d of dispatched) {
				if (seenMods.has(d.mod)) continue
				seenMods.add(d.mod)
				const src = readFileSync(join(routesAbs, `${d.mod}.v`), 'utf8')
				const fns = parseVFile(src)
				mkdirSync(routesGenDir, { recursive: true })
				writeFileSync(join(routesGenDir, `${vSafe(d.mod)}.v`), emitRouteFile(d.mod, d.route, d.prefix, src, fns))
			}
			// Prune stale generated files (renamed/deleted routes).
			try {
				for (const f of readdirSync(routesGenDir)) {
					if (!f.endsWith('.v')) continue
					const stem = f.slice(0, -2)
					if (stem === 'server_gen') continue
					if (![...seenMods].some((m) => vSafe(m) === stem)) {
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
				writeFileSync(join(routesGenDir, `server_gen.v`), emitServerGen(dispatched))
			}
			// Leaf-vs-index clash: foo.v + foo/index.v both exist.
			const seen = new Set(listVFiles(routesAbs).map((f) => modulePath(routesAbs, f)))
			for (const mod of seen) {
				if (mod !== 'index' && seen.has(`${mod}/index`)) {
					warnings.push(
						`${routesDir}/${mod}.v clashes with ${routesDir}/${mod}/index.v — ambiguous route`
					)
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
						if (e.isDirectory()) { walk(abs); continue }
						if (/\.(ts|js|mjs|cjs|svelte)$/.test(e.name)) {
							const rel = abs.split(sep).join('/').slice(libAbs.split(sep).join('/').length + 1)
							if (rel.split('/').includes('backend')) bad.push(`${libDir}/${rel}`)
						}
				}
				}
				try { walk(libAbs) } catch { /* ignore */ }
				for (const b of bad) warnings.push(`${b}: backend/ runs purely on V — no TS/JS/Svelte here (move it out of backend/)`)
			}
			for (const f of listVFiles(libAbs)) {
				const src = readFileSync(f, 'utf8')
				const mod = modulePath(libAbs, f)
				// #lib/backend convention (spec §7): backend-only, no stub, no
				// browser import — record types for V-to-V reference only.
				if (isBackendMod(mod)) continue
				const rpcFns = parseVFile(src).filter((x) => x.attr === 'rpc')
				const verbFns = parseVFile(src).filter((x) => x.attr !== 'rpc')
				for (const vf of verbFns) {
					warnings.push(
						`${libDir}/${mod}.v: @[${vf.attr}] on ${vf.name} is ignored in #lib — only @[rpc] exposes (still exported as RPC)`
					)
				}
				if (rpcFns.length === 0 && verbFns.length === 0) continue
				const allFns = [...rpcFns, ...verbFns]
				emitTypes('lib', mod, src, allFns)
				const genModDir = join(genDir, 'generated', 'lib', mod.split('/').slice(0, -1).join('/'))
				mkdirSync(genModDir, { recursive: true })
				writeFileSync(join(genModDir, mod.split('/').pop() + '.js'), jsWasmFor(root, mod, allFns))
				try {
					const outWasm = resolve(root, devWasmDir, mod + '.wasm')
					let fresh = false
					try { fresh = statSync(outWasm).mtimeMs >= statSync(f).mtimeMs } catch { /* missing */ }
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
				for (const l of body) decls.push(`  ${l}`)
				decls.push(`}`)
				decls.push('')
			}
			for (const key of [...bodies.keys()].filter((k) => k.startsWith('routes/'))) {
				emit(`#routes/${key.slice('routes/'.length)}.v`, 'routes', key.slice('routes/'.length))
			}
			for (const key of [...bodies.keys()].filter((k) => k.startsWith('lib/'))) {
				emit(`#lib/${key.slice('lib/'.length)}.v`, 'lib', key.slice('lib/'.length))
			}
			decls.push(`// Fallback for unknown .v files only.`)
			decls.push(`declare module '*.v' {`)
			decls.push(`  const __swelte_untyped: any;`)
			decls.push(`  export default __swelte_untyped;`)
			decls.push(`}`)
			decls.push('')
			writeFileSync(join(genDir, 'v-shim.d.ts'), decls.join('\n'))
		}
		for (const w of warnings) console.warn(`[swelte] ${w}`)
		writeFileSync(join(genDir, 'sdk.ts'), '// Auto-generated by swelte. Do not edit.\n')
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
						{ find: /^#routes(\/.*)?$/, replacement: `${routesAbs}$1` },
						{ find: /^#lib(\/.*)?$/, replacement: `${libAbs}$1` },
					],
				},
			}
		},
		configResolved(config) {
			activeRoot = config.root
			try {
				generate(config.root)
			} catch {
				/* dev continues */
			}
		},
		buildStart() {
			// Production builds must regenerate (configResolved may run in a
			// different context; never reuse a stale .swelte/ from dev).
			usedLibFiles.clear()
			try {
				generate(activeRoot || process.cwd())
			} catch (e) {
				throw e
			}
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
				if (underLib) {
					const rel = norm.slice(libNorm.length + 1)
					if (isBackendMod(rel)) {
						const impNorm = importer.split('?')[0].split(sep).join('/')
						const impUnderRoutesV = impNorm.endsWith('.v')
						if (!impUnderRoutesV) {
							throw new Error(
								`[swelte] ${source} is backend-only (#lib/backend convention): ` +
									`imported by ${importer}. Move the fn or import from a #routes/*.v file.`
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
				const fns = parseVFile(src)
				if (fns.length === 0) return 'export {}; // swelte: no RPC fns in this .v file'
				return jsFetchFor(routeFor(routesAbs, abs), fns)
			}
			if (norm === libNorm || norm.startsWith(`${libNorm}/`)) {
				const mod = modulePath(libAbs, abs)
				if (isBackendMod(mod)) {
					throw new Error(
						`[swelte] ${abs} is backend-only (#lib/backend) and cannot be imported in browser code.`
					)
				}
				const rpcFns = parseVFile(src).filter((x) => x.attr === 'rpc')
				const verbFns = parseVFile(src).filter((x) => x.attr !== 'rpc')
				const allFns = [...rpcFns, ...verbFns]
				if (allFns.length === 0) return 'export {}; // swelte: no RPC fns in this .v file'
				return jsWasmFor(root, mod, allFns)
			}
			return null
		},
		configureServer(server) {
			const watch = [resolve(routesDir), resolve(libDir)]
			server.watcher.add(watch)
			const regen = (file: string) => {
				if (!file.endsWith('.v')) return
				try {
					generate(server.config.root)
				} catch {
					/* ignore */
				}
				try {
					const libAbs = resolve(server.config.root, libDir)
					const norm = file.split(sep).join('/')
					const libNorm = libAbs.split(sep).join('/')
					if (norm === libNorm || norm.startsWith(libNorm + '/')) {
						const mod = modulePath(libAbs, file)
						const virt = '\0swelte:v:' + resolve(server.config.root, libDir, mod + '.v')
						const m = server.moduleGraph.getModuleById(virt)
						if (m) server.moduleGraph.invalidateModule(m)
					}
				} catch { /* HMR best-effort */ }
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
							const fp = resolve(server.config.root, devWasmDir, mod + '.wasm')
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
							if (isSelf && req.method === 'GET' && !url.searchParams.has('q') && !accept.includes('application/json')) return next()
							const looksRpc =
								ctype.includes('application/json') ||
								(req.method === 'GET' && accept.includes('application/json')) ||
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
								if (seenFns.has(fn.name)) throw new Error('WASM bundle: duplicate fn ' + fn.name + ' (in ' + mod + '.v)')
								seenFns.add(fn.name)
								for (const p of fn.params) {
									if (wasmParamKind(p.vtype) === null) throw new Error(libDir + '/' + mod + '.v: ' + fn.name + ' unsupported param')
								}
								if (fn.fallible) throw new Error(libDir + '/' + mod + '.v: ' + fn.name + ' is fallible')
								if (wasmReturnKind(fn.vret) === null) throw new Error(libDir + '/' + mod + '.v: ' + fn.name + ' unsupported return')
							}
							const blocked = wasmBlockedImports(src)
							if (blocked.length > 0) throw new Error(libDir + '/' + mod + '.v: blocked import(s): ' + blocked.join(', '))
							const broken = [...new Set(
								[...src.matchAll(/^\s*import\s+([^\n;]+)/gm)]
									.flatMap((m) => m[1].split(','))
									.map((p) => p.trim().split(/\s+/).pop() as string)
									.map((mm) => mm.split('.')[0])
									.filter((top) => WASM_KNOWN_BROKEN.has(top))
							)]
							if (broken.length > 0) throw new Error(libDir + '/' + mod + '.v: uses known-broken wasm stdlib (' + broken.join(', ') + ') — V 0.5.2 backend limitation')
							parts.push(src.replace(/^\s*module\s+\S+.*$/m, '').replace(/@\[([^\]]*)\]\s*/g, (_m, attrs: string) => {
								const keep = attrs.split(';').map((a: string) => a.trim()).filter((a: string) => a && !/^(rpc|get|post|put|delete|patch)\b/.test(a))
								return keep.length > 0 ? '@[' + keep.join('; ') + '] ' : ''
							}))
						}
						const entry = ['module main', '', "@[export: 'swelte_alloc']", 'pub fn swelte_alloc(n int) &u8 {', '\treturn unsafe { malloc(if n <= 0 { 1 } else { n }) }', '}', '', ...parts].join('\n')
						const tmpEntry = join(resolve(root, outDir), '.bundle.compile.v')
						writeFileSync(tmpEntry, entry)
						try {
							const tmpWasm = join(resolve(root, outDir), '.' + prodWasmName)
							if (!vBin) vBin = resolveV(import.meta.url)
							execVSync(vBin, ['-b', 'wasm', '-os', 'browser', '-o', tmpWasm, tmpEntry], { stdio: ['ignore', 'pipe', 'pipe'] })
							const bytes = readFileSync(tmpWasm)
							const ref = this.emitFile({ type: 'asset', name: prodWasmName, source: bytes })
							const fileName = this.getFileName(ref)
							for (const [id, info] of Object.entries(bundle)) {
								if (id.endsWith('.js') && info.type === 'chunk' && info.code.includes('/assets/' + prodWasmName)) {
									info.code = info.code.split('/assets/' + prodWasmName).join('/' + fileName)
								}
							}
							try { rmSync(tmpWasm) } catch { /* ignore */ }
						} finally {
							try { rmSync(tmpEntry) } catch { /* ignore */ }
						}
					}
				}
			void _opts
			void bundle
		},
	}
}

function wasmDevMiddleware(server: { config: { root: string }; watcher: unknown; moduleGraph: unknown }): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
	void server
	return (_req: IncomingMessage, _res: ServerResponse, _next: () => void) => undefined
}

export default swelte
