import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

export interface SweltePluginOptions {
	routesDir?: string
	libDir?: string
	outDir?: string
	/** V backend base URL for dev RPC proxy (e.g. http://localhost:8131). Unset = no proxy. */
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
	attr: 'get' | 'post' | 'rpc'
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

function parseVFile(src: string): RpcFn[] {
	const structs = parseStructs(src)
	const structByName = new Map(structs.map((s) => [s.name, s]))
	const fns: RpcFn[] = []
	const re =
		/@\[(get|post|rpc)\]\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*([?!]?[A-Za-z_\][\w.[\]]*|\([^)]*\))?/g
	let m: RegExpExecArray | null
	while ((m = re.exec(src)) !== null) {
		const attr = m[1] as RpcFn['attr']
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
		fns.push({ name, attr, params, vret, tsret: tsTypeFor(vret), fallible, singleArgsStruct })
	}
	return fns
}

function listVFiles(dir: string): string[] {
	if (!existsSync(dir)) return []
	const out: string[] = []
	for (const e of readdirSync(dir)) {
		const p = join(dir, e)
		const st = statSync(p)
		if (st.isDirectory()) out.push(...listVFiles(p))
		else if (e.endsWith('.v')) out.push(p)
	}
	return out
}

function modulePath(root: string, file: string): string {
	return relative(root, file).replace(/\.v$/, '').split(sep).join('/')
}

function tsTypeFor(vType: string): string {
	const t = vType.trim()
	if (/^string$/.test(t)) return 'string'
	if (/^(bool)$/.test(t)) return 'boolean'
	if (
		/^(int|i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|f32|f64|float|fsize|byte|rune|time\.Duration)$/.test(
			t
		)
	)
		return 'number'
	if (/^time\.Time$/.test(t)) return 'string'
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
	const vBackendUrl = options.vBackendUrl
	let activeRoot = ''
	function serverRoot(): string {
		return activeRoot
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

	/** Codegen: fetch stub for a `#routes/*.v` file. */
	function jsFetchFor(route: string, fns: RpcFn[]): string {
		const lines = [
			'// Auto-generated by swelte from V signatures. Do not edit.',
			`import { __swelteFetch } from '@swelte/core';`,
			'',
		]
		for (const fn of fns) {
			lines.push(`export function ${fn.name}(args) {`)
			lines.push(
				`  return __swelteFetch(${JSON.stringify(route)}, ${JSON.stringify(fn.name)}, ${JSON.stringify(fn.attr)}, args);`
			)
			lines.push('}')
			lines.push('')
		}
		return lines.join('\n')
	}

	/** Codegen: WASM stub for a `#lib/*.v` file. */
	function jsWasmFor(root: string, mod: string, fns: RpcFn[]): string {
		// wasm artifact: per-file `v -b wasm` output lands in
		// .swelte/generated/lib/<mod>.wasm (migration step 3 wires the real
		// compile). Absolute ?url import so Rollup never re-resolves against
		// the virtual id. Until the artifact exists, __swelteWasmCall falls
		// back to the in-process registry.
		const wasmAbs = join(root, outDir, 'generated', 'lib', `${mod}.wasm`)
		const lines = [
			`// Auto-generated by swelte from ${mod}.v — do not edit.`,
			`import { __swelteWasmCall } from '@swelte/core';`,
			`const wasmUrl = ${JSON.stringify(`${wasmAbs}?url`)};`,
			'',
		]
		for (const fn of fns) {
			lines.push(`let ${fn.name}_warned = false;`)
			lines.push(`export function ${fn.name}(args) {`)
			lines.push(
				`  if (!${fn.name}_warned) { ${fn.name}_warned = true; console.warn('[swelte] ${mod}.v:${fn.name} WASM not compiled yet — using dev fallback'); }`
			)
			lines.push(`  return __swelteWasmCall(wasmUrl, ${JSON.stringify(fn.name)}, args);`)
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

		function emitTypes(sub: string, mod: string, src: string, fns: RpcFn[]): string {
			const dir = join(typesDir, sub, mod.split('/').slice(0, -1).join('/'))
			mkdirSync(dir, { recursive: true })
			const base = mod.split('/').pop() || 'index'
			const file = join(dir, `${base}.d.ts`)
			const out: string[] = ['// Auto-generated by swelte from V signatures. Do not edit.', '']
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
				const fns = parseVFile(src).filter((x) => x.attr !== undefined && x.attr !== null)
				const rpcFns = fns.filter((x) => x.attr === 'get' || x.attr === 'post' || x.attr === 'rpc')
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
				if (rpcFns.length === 0) continue
				emitTypes('routes', mod, src, rpcFns)
				// Runtime fetch stub for the browser import (dev + build).
				const genModDir = join(genDir, 'generated', 'routes', mod.split('/').slice(0, -1).join('/'))
				mkdirSync(genModDir, { recursive: true })
				writeFileSync(
					join(genModDir, `${mod.split('/').pop()}.js`),
					jsFetchFor(routeFor(routesAbs, f), rpcFns)
				)
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
			for (const f of listVFiles(libAbs)) {
				const src = readFileSync(f, 'utf8')
				const mod = modulePath(libAbs, f)
				// #lib/server convention (spec §9): server-only, no stub, no
				// browser import — record types for V-to-V reference only.
				if (mod.split('/').includes('server')) continue
				const rpcFns = parseVFile(src).filter((x) => x.attr === 'rpc')
				const verbFns = parseVFile(src).filter((x) => x.attr === 'get' || x.attr === 'post')
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
				writeFileSync(join(genModDir, `${mod.split('/').pop()}.js`), jsWasmFor(root, mod, allFns))
			}
		}
		// Editor resolution (spec §4, roadmap §3): everything lives in
		// .swelte/ — src/ is never written. Two artifacts:
		//
		// 1. v-shim.d.ts: one `declare module` per known `#routes/x.v` /
		//    `#lib/y.v` with the type BODIES INLINED (no `export * from`,
		//    which TS forbids with relative names inside ambient modules
		//    — TS2686). Bodies are copied from the sibling
		//    types/<sub>/<mod>.d.ts at generate() time, so the single
		//    source of truth stays parseVFile/parseStructs.
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
				const rpcFns = parseVFile(src).filter(
					(x) => x.attr === 'get' || x.attr === 'post' || x.attr === 'rpc'
				)
				if (rpcFns.length === 0) continue
				collect('routes', modulePath(routesAbs, f))
			}
			if (existsSync(libAbs)) {
				for (const f of listVFiles(libAbs)) {
					const mod = modulePath(libAbs, f)
					if (mod.split('/').includes('server')) continue
					const src = readFileSync(f, 'utf8')
					const fns = parseVFile(src).filter(
						(x) => x.attr === 'get' || x.attr === 'post' || x.attr === 'rpc'
					)
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
		config(userConfig) {
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
				// #lib/server convention (spec §9): server-only — refuse from
				// client code with a loud error naming importer+file.
				if (underLib) {
					const rel = norm.slice(libNorm.length + 1)
					if (rel.split('/').includes('server')) {
						const impNorm = importer.split('?')[0].split(sep).join('/')
						const impUnderRoutesV = impNorm.endsWith('.v')
						if (!impUnderRoutesV) {
							throw new Error(
								`[swelte] ${source} is server-only (#lib/server convention): ` +
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
				const fns = parseVFile(src).filter(
					(x) => x.attr === 'get' || x.attr === 'post' || x.attr === 'rpc'
				)
				if (fns.length === 0) return 'export {}; // swelte: no RPC fns in this .v file'
				return jsFetchFor(routeFor(routesAbs, abs), fns)
			}
			if (norm === libNorm || norm.startsWith(`${libNorm}/`)) {
				const mod = modulePath(libAbs, abs)
				if (mod.split('/').includes('server')) {
					throw new Error(
						`[swelte] ${abs} is server-only (#lib/server) and cannot be imported in browser code.`
					)
				}
				const rpcFns = parseVFile(src).filter((x) => x.attr === 'rpc')
				const verbFns = parseVFile(src).filter((x) => x.attr === 'get' || x.attr === 'post')
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
			}
			server.watcher.on('add', regen)
			server.watcher.on('change', regen)
			server.watcher.on('unlink', regen)
			// Dev: proxy / and /api/* RPC to the V backend when vBackendUrl is
			// set; otherwise pass through to Vite.
			if (vBackendUrl) {
				server.middlewares.use(
					async (
						req: IncomingMessage & { url?: string; method?: string },
						res: ServerResponse,
						next: () => void
					) => {
						try {
							const url = new URL(req.url ?? '/', 'http://localhost')
							const isRpc = url.pathname === '/' || url.pathname.startsWith('/api/')
							if (!isRpc) return next()
							const accept = String(req.headers['accept'] ?? '')
							const ctype = String(req.headers['content-type'] ?? '')
							const isSelf = url.pathname === '/'
							// SPA first: browser page loads (GET / Accept: text/html, no ?fn=)
							// are never RPC — let Vite serve index.html. Only JSON GETs with
							// ?fn= (or explicit Accept: application/json) and POSTs proxy.
							if (isSelf && req.method === 'GET' && !url.searchParams.has('fn')) return next()
							const looksRpc =
								(req.method === 'POST' && ctype.includes('application/json')) ||
								(req.method === 'GET' &&
									(url.searchParams.has('fn') || accept.includes('application/json'))) ||
								(req.method === 'POST' &&
									isSelf &&
									(ctype.includes('multipart/form-data') ||
										ctype.includes('application/x-www-form-urlencoded')))
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
						} catch {
							next()
						}
					}
				)
			}
		},
	}
}

export default swelte
