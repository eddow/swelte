import { execFileSync as execVSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'
import { loadConfig, renderAppDts, renderClientEntry, renderHarness } from '../gen/config.js'
import { isBackendMod, SWELTE_GEN_CORE_DIRS } from '../gen/paths.js'
import { resolveV } from '../toolchain.js'
import { emitClientRouter } from './client-router.js'
import { list, writeIfChanged } from './fs.js'
import { loadServerHooks } from './hooks.js'
import { loadMatchers } from './matchers.js'
import { parseStructs, parseVFile, pascal } from './parse.js'
import {
	collectPrerenderEntries,
	collectSvelteManifest,
	listFilesWithExt,
	listVFiles,
	modulePath,
	relPosix,
	routeFor,
	routeParams,
	routeParamTs,
	stripRouteGroups,
	svelteModKind,
	vFileSafe,
	vPrefix,
} from './routes.js'
import {
	ancestorDirs,
	doubleClaimCheck,
	emitRouteFile,
	emitServerGen,
	leafDirOf,
	validateLoadFn,
	validateMiddlewareFn,
	validateRpcFn,
	validateSseFn,
	validateVerbFn,
	validateWsFn,
	vType,
} from './server-gen.js'
import {
	renderServiceWorker,
	renderServiceWorkerRegister,
	serviceWorkerPrecache,
} from './service-worker.js'
import { jsFetchFor, jsWasmFor, wasmParamKind, wasmReturnKind } from './stubs.js'
import type {
	LoadFn,
	MatcherDef,
	RouteLimits,
	RpcFn,
	SweltePluginOptions,
	VStruct,
	WrapperMw,
} from './types.js'
import { compileLibWasm, WASM_KNOWN_BROKEN, wasmBlockedImports } from './wasm.js'

export function swelte(options: SweltePluginOptions = {}): Plugin {
	let routesDir = options.routesDir ?? 'src/routes'
	let libDir = options.libDir ?? 'src/lib'
	let outDir = options.outDir ?? '.swelte'
	// Roadmap §1: SvelteKit knob parity (config < env — env wins at runtime,
	// like BODY_LIMIT/RATE_LIMIT; generate() bakes the resolved value).
	let trailingSlash: 'always' | 'never' | 'ignore' =
		options.trailingSlash === 'always' || options.trailingSlash === 'never'
			? options.trailingSlash
			: 'ignore'
	let appBase = String(options.base ?? '')
	let appAssets = String(options.assets ?? options.base ?? '')
	let appCsp = String(options.csp ?? '')
	let appVersion = String(options.version ?? '')
	const appSw: { enabled?: boolean; register?: 'auto' | 'manual' } = {
		enabled: options.serviceWorker?.enabled === true,
		register: options.serviceWorker?.register === 'manual' ? 'manual' : 'auto',
	}
	let appPrerender: { entries: 'off' | 'static' | 'all'; concurrency: number } = {
		entries:
			options.prerender?.entries === 'all'
				? 'all'
				: options.prerender?.entries === 'static'
					? 'static'
					: 'off',
		concurrency:
			typeof options.prerender?.concurrency === 'number' && options.prerender.concurrency > 0
				? Math.floor(options.prerender.concurrency)
				: 4,
	}
	let appOffline: { fallback: string } = {
		fallback:
			options.offline?.fallback === true
				? 'offline.html'
				: typeof options.offline?.fallback === 'string' && options.offline.fallback !== ''
					? options.offline.fallback
					: 'off',
	}
	let appChunking: 'single' | 'layout' | 'route' =
		options.chunking === 'single' || options.chunking === 'layout' || options.chunking === 'route'
			? options.chunking
			: 'layout'
	// V+TS plugins (core contract `SweltePlugin`; `@swelte/plus` is one
	// collection — third-party plugins implement the same interface).
	// Default [] = parity-only output, byte-identical to today. Plugin attrs
	// (extraAttrs) parse with bodies through parseVFile; core ignores
	// plugin-claimed fns everywhere except plugin validate() dispatch.
	const plugins = options.plugins ?? []
	const extraAttrs = [...new Set(plugins.flatMap((p) => p.attrs))]
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
	// Chunk grouping for manualChunks: `.swelte/chunks.json` (mod -> chunk
	// key), written by generate(). `config()` runs before generate() in a
	// fresh process, so the group map is read lazily at bundle time from
	// disk — never from closure state. Null when `single`.
	function swelteChunkGroup(root: string): { routesAbs: string; map: Map<string, string> } | null {
		if (appChunking === 'single') return null
		try {
			const raw = readFileSync(join(resolve(root, outDir), 'chunks.json'), 'utf8')
			const parsed = JSON.parse(raw) as { mode?: string; chunks?: Record<string, string[]> }
			if (!parsed || typeof parsed.chunks !== 'object') return null
			const map = new Map<string, string>()
			for (const [key, mods] of Object.entries(parsed.chunks))
				for (const m of mods ?? []) map.set(m, key)
			if (map.size === 0) return null
			return { routesAbs: resolve(root, routesDir), map }
		} catch {
			return null
		}
	}
	function swelteManualChunk(
		group: { routesAbs: string; map: Map<string, string> } | null,
		id: string
	): string | null {
		if (!group) return null
		const q = id.indexOf('?')
		const clean = (q >= 0 ? id.slice(0, q) : id).split(sep).join('/')
		const root = group.routesAbs.split(sep).join('/')
		if (!clean.startsWith(`${root}/`) || !clean.endsWith('.svelte')) return null
		const hit = group.map.get(clean.slice(root.length + 1, -'.svelte'.length))
		return hit ? `swelte-${hit.replace(/[^A-Za-z0-9_-]/g, '_')}` : null
	}
	// Roadmap §6 tree-shaking: every .v import resolved through the plugin
	// is recorded here (abs path → same). generateBundle compiles only the
	// recorded client-used #lib/ files — untouched helpers never enter
	// the prod wasm. Reset per build (buildStart) so dev/test resolutions
	// never leak into a bundle.
	const usedLibFiles = new Set<string>()
	// Lazy V binary for `v -b wasm` (resolved on first compile).
	let vBin = ''
	const vBackendUrl =
		options.vBackendUrl ?? process.env.SWELTE_V_BACKEND_URL ?? process.env.VITE_SWELTE_V_BACKEND_URL

	function serverRoot(): string {
		return activeRoot
	}

	/** Middleware shapes (§7). */

	/** RPC shape: protocol-ignorant typed call. One args-struct in,
	 * typed value out (or throw → TS reject). No HTTP types allowed:
	 * no SwelteRequest/SwelteResponse params, no SwelteResponse/[]u8/(int,string)
	 * returns — those are verb (HTTP) shapes. Runs in #routes/ (fetch) and
	 * #lib/ (local WASM) identically. */

	/** Verb shape: HTTP endpoint. Either `(SwelteRequest)` (+ optional narrow
	 * params) or a bare/narrow signature, returning `string`/struct (JSON),
	 * `[]u8` (binary), `(int, string)` (status+text), or `SwelteResponse`
	 * (full control). `@[rpc]`-style free-form typed returns without the
	 * request stay on `@[rpc]` — verbs without `SwelteRequest` must still be
	 * HTTP-typed (one of the four). */

	/** Loader shape: `@[load] name(req SwelteRequest[, parent T]) !R`.
	 * Level 0 (no ancestor load): exactly one param (SwelteRequest).
	 * Deeper levels: `(SwelteRequest, parent T)` where T is the previous
	 * level's return struct (prefixed name, same merged file — no import).
	 * Mismatch → build error (the layout contract, enforced).
	 * Returns the page-data value for this level — any JSON-able V value.
	 * No qualifier (loaders run for the whole page, not one ?q).
	 * Throw → +error props. */

	/** URL dir of a leaf mod (`admin/users` for the file serving /admin/users). */

	/** SSE events accessor (§14, true streaming via veb). Per file with
	 * `@[sse]` fns: `swelte_sse_events(qualifier, req)` returns the fn's
	 * event list for the qualifier, or an error for unknown qualifiers /
	 * fallible failures. `before_request` calls this (it owns `ctx`),
	 * then streams via `swelte_serve_sse`. No body, no sentinel. */

	/** Loader cascade: `swelte_load(req)` runs ancestor +route `@[load]`
	 * fns root-first; each level returns its typed value (struct, map,
	 * string, array — any JSON-able V type). The cascade threads values:
	 * level N receives level N-1's return as `parent` (typed, already
	 * built — no decode, no JSON in `.v` files). The leaf's return is
	 * `json.encode`d once at the edge → page props.
	 * No loads anywhere → `'{}'`. Any throw → error (caller maps to +error).
	 * Each load is called under its OWNING file's prefix (wrappers are
	 * inlined under the wrapper prefix — same as @[before]/@[after]). */

	/** Extracted verb/rpc body (unchanged semantics — moved verbatim out
	 * of emitRouteFile so both chained and unchained leaves share it).
	 * `sharedReq`: §7 pre-chain request (already @[before]-filtered) —
	 * verb branches reuse it instead of building their own; null =
	 * build locally (byte-identical to the old inline code). */

	function generate(root: string): Promise<void> {
		const run = genChain.then(() =>
			(async () => {
				// Unified config is the source of truth: unspecified plugin
				// options fall back to the `swelte` key in svelte.config.js.
				// Explicit plugin options always win (back-compat).
				try {
					const { loadConfig } = await import('../gen/config.js')
					const cfg = await loadConfig(root)
					if (options.routesDir === undefined) routesDir = cfg.routesDir
					if (options.libDir === undefined) libDir = cfg.libDir
					if (options.outDir === undefined) outDir = cfg.outDir
					if (options.trailingSlash === undefined && cfg.trailingSlash !== 'ignore')
						trailingSlash = cfg.trailingSlash
					if (options.base === undefined && cfg.base !== '') appBase = cfg.base
					if (options.assets === undefined && (cfg.assets !== '' || cfg.base !== ''))
						appAssets = cfg.assets
					if (options.csp === undefined && cfg.csp !== '') appCsp = cfg.csp
					if (options.version === undefined && cfg.version !== '') appVersion = cfg.version
					// SW gate: config can only turn ON (never force off) — the
					// live SWELTE_SW=1 env read in config() must survive this
					// fallback (env wins over config unset/off).
					if (options.serviceWorker?.enabled === undefined && cfg.serviceWorker.enabled)
						appSw.enabled = true
					if (process.env.SWELTE_SW === '1') appSw.enabled = true
					if (options.serviceWorker?.register === undefined)
						appSw.register = cfg.serviceWorker.register
					if (options.prerender === undefined && cfg.prerender.entries !== 'off') {
						appPrerender = {
							entries: cfg.prerender.entries,
							concurrency: cfg.prerender.concurrency,
						}
					}
					if (options.offline === undefined && cfg.offline.fallback !== 'off')
						appOffline = { fallback: cfg.offline.fallback }
					if (options.chunking === undefined && cfg.chunking !== 'layout')
						appChunking = cfg.chunking
					if (
						process.env.SWELTE_CHUNKING === 'single' ||
						process.env.SWELTE_CHUNKING === 'layout' ||
						process.env.SWELTE_CHUNKING === 'route'
					)
						appChunking = process.env.SWELTE_CHUNKING
				} catch {
					/* defaults stand */
				}
				const genDir = resolve(root, outDir)
				const typesDir = join(genDir, 'types')
				mkdirSync(genDir, { recursive: true })
				mkdirSync(typesDir, { recursive: true })
				const warnings: string[] = []
				const dispatched: { route: string; mod: string; prefix: string }[] = []
				// Room-mode SSE (future.md #4) or @[ws] (future.md #3) present
				// in any route file → harness imports the backend hub module.
				// Declared here so the harness render below sees the route-loop result.
				let hasRoomSse = false
				// Hoisted prelude (bridge stub + backend includes + marker):
				// generate() must leave a compilable .swelte/ even when the
				// route loop below throws (e.g. dev pre-generate swelte({})
				// while routes need dbPlugin). Without this, a shape error
				// aborts before the stub arrives and the V backend can never
				// boot. Idempotent — the main passes below rewrite the same
				// bytes on success.
				try {
					const earlyRoutesGenDir = join(genDir, 'routes')
					const earlyBridgePath = join(earlyRoutesGenDir, 'swelte_qjs_bridge.v')
					if (!existsSync(earlyBridgePath)) {
						mkdirSync(earlyRoutesGenDir, { recursive: true })
						writeIfChanged(
							earlyBridgePath,
							[
								'// Auto-generated by swelte (core stub). The @swelte/ssr-qjs',
								'// adapter overwrites this file with the real QuickJS bridge',
								'// during `swelte build`. Without the adapter, embedded SSR',
								'// is unavailable: not-ok → Hand falls back to the sidecar',
								'// proxy / SPA shell.',
								'module routes',
								'',
								'pub fn swelte_qjs_render_page(route string, props_json string) (string, bool) {',
								'\t_ = route',
								'\t_ = props_json',
								"\treturn '', false",
								'}',
								'',
							].join('\n')
						)
					}
				} catch {
					/* ignore — main pass retries below */
				}
				try {
					// Never clobber the marker from a plugin-less run: dev's
					// pre-generate calls swelte({}) (no dbPlugin), which would
					// rewrite ["backend"] → [] and confuse the -enable-globals
					// detector on the next boot.
					if (plugins.length > 0) {
						const earlyWanted = new Set<string>()
						for (const pp of plugins) {
							let earlyIncs: { module: string; absDir: string }[] = []
							try {
								earlyIncs = pp.includes?.() ?? []
							} catch {
								continue
							}
							for (const inc of earlyIncs) {
								if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inc.module)) continue
								if (inc.module === 'routes' || inc.module === 'main') continue
								let earlyFiles: string[] = []
								try {
									earlyFiles = readdirSync(inc.absDir).filter((f) => f.endsWith('.v'))
								} catch {
									continue
								}
								earlyWanted.add(inc.module)
								const dest = join(genDir, inc.module)
								mkdirSync(dest, { recursive: true })
								for (const f of earlyFiles) {
									try {
										writeIfChanged(join(dest, f), readFileSync(join(inc.absDir, f), 'utf8'))
									} catch {
										/* unreadable file — skip */
									}
								}
							}
						}
						writeIfChanged(
							join(genDir, 'plugin_modules.json'),
							JSON.stringify([...earlyWanted].sort())
						)
					}
				} catch {
					/* ignore — main pass retries below */
				}

				// Custom param matchers (`src/matchers.v`, `@[matcher]`).
				// Builtin fallback when absent: `{ integer }`.
				let matchers: Map<string, MatcherDef>
				matchers = loadMatchers(root)
				const knownMatchers = new Set(matchers.keys())
				// Lifecycle hooks (`src/app.v`, core attrs `@[startup]`/`@[reroute]`/`@[error]`).
				// Missing file → no-op hooks (harness byte-identical). Plugins own
				// their attrs via loadAppHooks: collected here, errors thrown like
				// core shape errors, fragments merged into the harness fragments.
				const hooks = loadServerHooks(root)
				const appHookFragments: { imports?: string; main?: string; mainInner?: string }[] = []
				for (const plug of plugins) {
					if (!plug.loadAppHooks) continue
					const got = plug.loadAppHooks(root)
					if (got.errors?.length) throw new Error(got.errors[0])
					if (got.fragment) appHookFragments.push(got.fragment)
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
					if (route !== '') {
						// Per-route params + id (SvelteKit `$types` lite):
						// `Params` lists the dynamic segments, `RouteId` the pattern.
						const dynPs = routeParams(route)
						out.push(
							`export type RouteId = ${JSON.stringify(route)}`,
							`export interface Params {`,
							...dynPs.map((n) => `	${n}: ${routeParamTs(route, n)}`),
							`}`,
							``
						)
					}
					if (fns.some((f) => f.attr !== 'rpc')) {
						out.push(`export interface SwelteCookie {
	name: string
	value: string
	path?: string
	max_age?: number
	expires?: string
	domain?: string
	secure?: boolean
	http_only?: boolean
	same_site?: string
}
export interface SwelteResponse {
	status: number
	headers: Record<string, string>
	cookies: SwelteCookie[]
	body: string | Blob
	body_bytes?: Uint8Array
	is_bytes: boolean
}
export interface SwelteRequest {
	query: Record<string, string>
	form: Record<string, string>
	files: Record<string, string>
	headers: Record<string, string>
	cookies: Record<string, string>
	params: Record<string, string>
	locals: Record<string, string>
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
					for (const fn of fns) {
						const isVerb = fn.attr !== 'rpc' && fn.attr !== 'ws'
						// WS fns (future.md #3): no fetch stub — the browser
						// opens a native WebSocket. Emit the socket URL helper
						// type only (route + query shape); the Svelte side
						// constructs `new WebSocket(url)` itself.
						if (fn.attr === 'ws') {
							const dynPs = routeParams(route)
							out.push(`// ${fn.name}: WebSocket endpoint (no fetch stub — open a native socket).`)
							if (dynPs.length) {
								out.push(
									`export function ${fn.name}(args: { ${dynPs.map((n) => `${n}: ${routeParamTs(route, n)}`).join(', ')} } & Record<string, string>): string`
								)
							} else {
								out.push(`export function ${fn.name}(args?: Record<string, string>): string`)
							}
							out.push('')
							continue
						}
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
								// SSE (roadmap §14): three shapes — list (`[]string`),
								// emit (`emit` tail), room (`sub` + `emit` tail,
								// future.md #4). Shape errors throw in validateSseFn
								// (route loop); here only strip the harness-injected
								// tail from the client Args interface. `isReq`
								// covers (req), (req, emit), (req, sub, emit);
								// bare multi-param fns keep narrow args minus tail.
								const ps = fn.params
								const lastIsEmit =
									ps.length > 0 &&
									/^fn\s*\(\s*string\s*\)(\s*bool)?$/.test(ps[ps.length - 1].vtype.trim())
								const secondLastIsSub =
									lastIsEmit &&
									ps.length >= 2 &&
									/^fn\s*\(\s*string\s*\)\s*chan\s+string$/.test(ps[ps.length - 2].vtype.trim())
								const clientParams = lastIsEmit ? ps.slice(0, secondLastIsSub ? -2 : -1) : ps
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
											`export function ${fn.name}(args: { ${dynPs.map((n) => `${n}: ${routeParamTs(route, n)}`).join(', ')} } & Record<string, string>): AsyncGenerator<string, void, void>${fn.fallible ? ' // !T: may reject with SwelteRpcError' : ''}`
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
										`export function ${fn.name}(args: { ${dynPs.map((n) => `${n}: ${routeParamTs(route, n)}`).join(', ')} } & Record<string, string>): Promise<${Res}>`
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
					writeIfChanged(file, out.join('\n'))
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
					const strippedForClaim = stripRouteGroups(mod)
					const slash = strippedForClaim.lastIndexOf('/')
					const base = slash < 0 ? strippedForClaim : strippedForClaim.slice(slash + 1)
					const dir = slash < 0 ? '' : strippedForClaim.slice(0, slash)
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
						const allFns = parseVFile(src, extraAttrs)
						const mwFns = allFns.filter((x) => x.attr === 'before' || x.attr === 'after')
						const fns = allFns.filter((x) => x.attr !== 'before' && x.attr !== 'after')
						const rpcFns = fns.filter((x) => x.attr === 'rpc')
						const verbFns = fns.filter((x) => x.attr !== 'rpc')
						const mod = modulePath(routesAbs, f)
						const rel = relPosix(routesAbs, f)
						// V+TS plugins: the parser only emits core attrs + plugin-claimed
						// attrs (extraAttrs), so every fn here is known. Dispatch
						// plugin-claimed fns to the owning plugin's validate(); core
						// attrs fall through to the shape checks below.
						for (const pl of plugins)
							for (const fn of allFns.filter((x) => pl.attrs.includes(x.attr)))
								pl.validate?.(`${routesDir}/${rel}`, fn)
						for (const bad of allFns.filter(
							(x) =>
								x.attr === 'matcher' ||
								x.attr === 'startup' ||
								x.attr === 'reroute' ||
								x.attr === 'error'
						))
							throw new Error(
								`[swelte] ${routesDir}/${rel}: @[${bad.attr}] ${bad.name} is only allowed in its own file (matcher → src/matchers.v, startup/reroute/error → src/app.v).`
							)
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
							const _sveltePartner = join(routesAbs, `${mod}.svelte`)
							const _svelteIndex = join(routesAbs, mod, 'index.svelte')
							const _sveltePage = join(routesAbs, mod, '+page.svelte')
							/* Really noisy and useless warning
					if (!existsSync(sveltePartner) && !existsSync(svelteIndex) && !existsSync(sveltePage)) {
						warnings.push(
							`${routesDir}/${mod}.v: no .svelte partner (page) and not under api/ — orphan route file`
						)
					}*/
						}
						if (
							rpcFns.length === 0 &&
							verbFns.length === 0 &&
							fns.every((x) => x.attr !== 'sse' && x.attr !== 'ws')
						)
							continue
						// @[load]: at most one per leaf file; never stacked with
						// a verb/rpc/sse/ws on the same fn (one transport per fn).
						// Signature: (SwelteRequest, parent string) — parent is
						// the aggregated JSON from ancestor +route loads
						// (root-first). Leaf merges and returns the page props.
						const loads = fns.filter((x) => x.attr === 'load')
						if (loads.length > 1)
							throw new Error(
								`[swelte] ${routesDir}/${rel}: two @[load] fns (${loads.map((l) => l.name).join(', ')}) — one loader per file.`
							)
						// WS: one socket per file (the socket IS the endpoint —
						// rooms are joined inside via sub(room)).
						const wsFns = fns.filter((x) => x.attr === 'ws')
						if (wsFns.length > 1) {
							const msg = `[swelte] ${routesDir}/${rel}: two @[ws] fns (${wsFns.map((w) => w.name).join(', ')}) — one socket per file`
							warnings.push(msg)
							throw new Error(msg)
						}
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
						// `@[get]` default on the same file (§14). WS is stricter:
						// one socket per file (no qualifier), and it stacks with
						// nothing. Stacking `@[sse]`/`@[ws]` with a verb
						// (`@[get; sse]`, `@[rpc; sse]`, `@[get; ws]`) on one fn
						// is a build error — parseVFile fans stacked attrs out to
						// one RpcFn per verb, so the same name shows up twice.
						for (const m of allFns.filter((x) => x.attr === 'sse' || x.attr === 'ws')) {
							const clash = allFns.find((x) => x.name === m.name && x.attr !== m.attr)
							if (clash)
								throw new Error(
									`[swelte] ${routesDir}/${rel}: @[${m.attr}] on ${m.name} cannot stack with @[${clash.attr}] — one transport per fn (SSE is GET+Accept-gated, WS is upgrade-gated, verbs are method-gated). Split into two fns.`
								)
						}
						for (const vb of ['get', 'post', 'put', 'delete', 'patch', 'sse', 'ws']) {
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
						// verbs = HTTP, rpc = protocol-ignorant (typed args/return, throw → reject).
						// sse = list / emit / room (validateSseFn owns all three shapes).
						// ws = bidirectional socket rooms (validateWsFn: (req, sub, emit)).
						for (const r of fns.filter((x) => x.attr === 'rpc'))
							validateRpcFn(`${routesDir}/${rel}`, r)
						for (const v of fns.filter((x) =>
							['get', 'post', 'put', 'delete', 'patch'].includes(x.attr)
						))
							validateVerbFn(`${routesDir}/${rel}`, v)
						for (const s of fns.filter((x) => x.attr === 'sse'))
							validateSseFn(`${routesDir}/${rel}`, s)
						for (const w of fns.filter((x) => x.attr === 'ws'))
							validateWsFn(`${routesDir}/${rel}`, w)
						const route = routeFor(routesDir, routesAbs, f, knownMatchers)
						if (route === null) continue // wrapper-only (handled above); leaf always has a route
						emitTypes(
							'routes',
							mod,
							src,
							fns.filter((x) => x.attr !== 'load'),
							route
						)
						// Dynamic-shape clash (section 8): two files normalizing to the
						// same shape (`users/[id]` vs `users/[slug]`) are ambiguous —
						// build error naming both files.
						for (const d of dispatched) {
							const shA = d.route
								.replace(/\[\.\.\.[^\]]+\]/g, '...')
								.replace(/\[\[([^\]]+)\]\]/g, '[?]')
								.replace(/\[[^\]]+\]/g, '[]')
							const shB = (route as string)
								.replace(/\[\.\.\.[^\]]+\]/g, '...')
								.replace(/\[\[([^\]]+)\]\]/g, '[?]')
								.replace(/\[[^\]]+\]/g, '[]')
							if (route.includes('[') && shA === shB)
								throw new Error(
									`[swelte] ${routesDir}/${rel} has the same dynamic shape as ${routesDir}/${d.mod}.v (${shB}) — rename one file.`
								)
						}
						// SSE room mode (future.md #4): trailing `sub fn (string)` +
						// `emit fn (string) bool` — the harness injects the room
						// subscribe closure. Track file-level room-ness for the
						// harness `import backend` decision below. Without a backend
						// include the harness cannot compile hub state — build error
						// naming the fix (install @swelte/plus/db).
						const isRoomSseFile = fns.some(
							(fn) =>
								fn.attr === 'sse' &&
								fn.params.length >= 2 &&
								/^fn\s*\(\s*string\s*\)\s*chan\s+string$/.test(
									fn.params[fn.params.length - 2].vtype.trim()
								) &&
								/^fn\s*\(\s*string\s*\)(\s*bool)?$/.test(
									fn.params[fn.params.length - 1].vtype.trim()
								)
						)
						if (isRoomSseFile) {
							hasRoomSse = true
							const hasBackend = plugins.some((pl) =>
								(pl.includes?.() ?? []).some((inc) => inc.module === 'backend')
							)
							if (!hasBackend) {
								throw new Error(
									`[swelte] ${routesDir}/${rel}: room-mode @[sse] needs the backend hub — add dbPlugin to swelte({ plugins: [...] }) (npm install @swelte/plus).`
								)
							}
						}
						// WS (future.md #3): same hub requirement — the route fn and
						// the harness frame loop both run against backend hub state.
						const isWsFile = fns.some((fn) => fn.attr === 'ws')
						if (isWsFile) {
							hasRoomSse = true
							const hasBackend = plugins.some((pl) =>
								(pl.includes?.() ?? []).some((inc) => inc.module === 'backend')
							)
							if (!hasBackend) {
								throw new Error(
									`[swelte] ${routesDir}/${rel}: @[ws] needs the backend hub — add dbPlugin to swelte({ plugins: [...] }) (npm install @swelte/plus).`
								)
							}
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
						writeIfChanged(
							join(genModDir, `${mod.split('/').pop()}.js`),
							jsFetchFor(
								route,
								fns.filter((x) => x.attr !== 'load'),
								trailingSlash,
								matchers
							)
						)
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
							const wf = `${join(routesAbs, ...wmod.split('/'))}.v`
							if (!existsSync(wf)) continue
							const wsrc = readFileSync(wf, 'utf8')
							const mws = parseVFile(wsrc, extraAttrs).filter(
								(x) => x.attr === 'before' || x.attr === 'after'
							)
							const lds = parseVFile(wsrc, extraAttrs).filter((x) => x.attr === 'load')
							if (mws.length === 0 && lds.length === 0) continue
							chain.push({
								wmod,
								src: wsrc,
								mws: mws.map((m) => ({ name: m.name, attr: m.attr as 'before' | 'after' })),
							})
							for (const l of lds) loads.push({ ...l, mod: wmod, file: `${routesDir}/${wmod}.v` })
						}
						const fns = parseVFile(src, extraAttrs).filter(
							(x) => x.attr !== 'before' && x.attr !== 'after' && x.attr !== 'load'
						)
						for (const l of parseVFile(src, extraAttrs).filter((x) => x.attr === 'load'))
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
						writeIfChanged(
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
					// Bridge STUB: when no adapter bridge exists, core writes
					// a no-op stub (same symbol, returns not-ok) so the
					// harness compiles in core-only projects. The adapter
					// overwrites it with the real bridge during `swelte build`
					// (generateBundle); the existsSync guard below never
					// clobbers the real one. In dev (no generateBundle) the
					// stub persists — correct, SSR runs via sidecar there.
					const ADAPTER_OWNED = new Set(['swelte_qjs_bridge'])
					const bridgePath = join(routesGenDir, 'swelte_qjs_bridge.v')
					if (!existsSync(bridgePath)) {
						mkdirSync(routesGenDir, { recursive: true })
						writeIfChanged(
							bridgePath,
							[
								'// Auto-generated by swelte (core stub). The @swelte/ssr-qjs',
								'// adapter overwrites this file with the real QuickJS bridge',
								'// during `swelte build`. Without the adapter, embedded SSR',
								'// is unavailable: not-ok → Hand falls back to the sidecar',
								'// proxy / SPA shell.',
								'module routes',
								'',
								'pub fn swelte_qjs_render_page(route string, props_json string) (string, bool) {',
								'\t_ = route',
								'\t_ = props_json',
								"\treturn '', false",
								'}',
								'',
							].join('\n')
						)
					}
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
						const wsMods = new Set<string>()
						for (const f of routeFiles) {
							try {
								const mod = modulePath(routesAbs, f)
								const fns = parseVFile(readFileSync(f, 'utf8'))
								if (fns.some((x) => x.attr === 'sse')) sseMods.add(mod)
								if (fns.some((x) => x.attr === 'ws')) wsMods.add(mod)
							} catch {
								/* ignore */
							}
						}
						// §4 ssr=false-lite: sibling `export const ssr = false`
						// opts the route out — Hand serves the SPA shell
						// (swelte_no_ssr predicate in server_gen.v).
						// csr=false-lite: sibling `export const csr = false`
						// renders SSR HTML only — client mount/hydrate no-op
						// (swelte_no_csr predicate + routes.js `csr: false`).
						// limits-lite: sibling `export const limits = {...}`
						// (leaf wins, else nearest explicit wrapper) lands in
						// the `swelte_route_limits()` table in server_gen.v.
						const noSsrRoutes: string[] = []
						const noCsrRoutes: string[] = []
						const routeLimits: { route: string; limits: RouteLimits }[] = []
						const serializedHeaders: { route: string; headers: string[] }[] = []
						try {
							for (const e of collectSvelteManifest(routesAbs, routesDir, vMods).entries) {
								if (e.kind === 'wrapper' || e.kind === 'error') continue
								if (e.ssr === false) noSsrRoutes.push(e.route)
								if (e.csr === false) noCsrRoutes.push(e.route)
								if (e.limits) routeLimits.push({ route: e.route, limits: e.limits })
								if (e.serializedHeaders)
									serializedHeaders.push({ route: e.route, headers: e.serializedHeaders })
							}
						} catch {
							/* no svelte routes */
						}
						writeIfChanged(
							join(routesGenDir, `server_gen.v`),
							emitServerGen(
								dispatched,
								sseMods,
								matchers,
								noSsrRoutes,
								noCsrRoutes,
								routeLimits,
								serializedHeaders,
								wsMods
							)
						)
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
						const rpcFns = parseVFile(src, extraAttrs).filter((x) => x.attr === 'rpc')
						// §7: middleware/verbs are meaningless in #lib — keep the
						// warn-and-expose-RPC behavior for verbs, extend it to
						// @[before]/@[after].
						const verbFns = parseVFile(src, extraAttrs).filter(
							(x) => x.attr !== 'rpc' && x.attr !== 'before' && x.attr !== 'after'
						)
						for (const vf of [
							...verbFns,
							...parseVFile(src, extraAttrs).filter(
								(x) => x.attr === 'before' || x.attr === 'after'
							),
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
						writeIfChanged(
							join(genModDir, `${mod.split('/').pop()}.js`),
							jsWasmFor(isBuild, mod, allFns)
						)
						try {
							const outWasm = join(devWasmDirFor(root), `${mod}.wasm`)
							let fresh = false
							try {
								fresh = statSync(outWasm).mtimeMs >= statSync(f).mtimeMs
							} catch {
								/* missing */
							}
							if (!fresh) compileLibWasm(src, mod, outWasm, `${libDir}/${mod}.v`)
						} catch (e) {
							throw new Error(`WASM compile failed: ${(e as Error).message}`)
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
						const fns = parseVFile(src, extraAttrs)
						if (fns.length === 0) continue
						collect('routes', modulePath(routesAbs, f))
					}
					if (existsSync(libAbs)) {
						for (const f of listVFiles(libAbs)) {
							const mod = modulePath(libAbs, f)
							if (isBackendMod(mod)) continue
							const src = readFileSync(f, 'utf8')
							const fns = parseVFile(src, extraAttrs)
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
					// Roadmap §1.5 + §1.9: virtual `#app/paths` + `#app/environment`
					// ambient declarations — resolved at runtime by the aliases below.
					decls.push(
						`declare module '#app/paths' {`,
						`	export const base: string`,
						`	export const assets: string`,
						`}`,
						``,
						`declare module '#app/environment' {`,
						`	export const browser: boolean`,
						`	export const dev: boolean`,
						`	export const building: boolean`,
						`	export const version: string`,
						`}`,
						``,
						`declare module '$app/stores' {`,
						`	export const page: unknown`,
						`	export const navigating: unknown`,
						`	export const updated: unknown`,
						`	export function goto(url: string, opts?: unknown): Promise<void>`,
						`	export function preloadData(url: string): Promise<unknown>`,
						`	export function preloadCode(url: string): Promise<unknown>`,
						`	export function pushState(url: string, state?: unknown): Promise<void>`,
						`	export function replaceState(url: string, state?: unknown): Promise<void>`,
						`	export function captureSnapshot(fn: unknown): () => void`,
						`	export function restoreSnapshot(fn: unknown): () => void`,
						`	export function beforeNavigate(fn: unknown): () => void`,
						`	export function afterNavigate(fn: unknown): () => void`,
						`	export function onNavigate(fn: unknown): () => void`,
						`}`,
						``,
						`declare module '$app/state' {`,
						`	export const page: unknown`,
						`	export const navigating: unknown`,
						`	export const updated: unknown`,
						`	export function goto(url: string, opts?: unknown): Promise<void>`,
						`	export function preloadData(url: string): Promise<unknown>`,
						`	export function preloadCode(url: string): Promise<unknown>`,
						`	export function pushState(url: string, state?: unknown): Promise<void>`,
						`	export function replaceState(url: string, state?: unknown): Promise<void>`,
						`	export function captureSnapshot(fn: unknown): () => void`,
						`	export function restoreSnapshot(fn: unknown): () => void`,
						`	export function beforeNavigate(fn: unknown): () => void`,
						`	export function afterNavigate(fn: unknown): () => void`,
						`	export function onNavigate(fn: unknown): () => void`,
						`}`,
						``,
						`declare module '$app/navigation' {`,
						`	export const page: unknown`,
						`	export const navigating: unknown`,
						`	export const updated: unknown`,
						`	export function goto(url: string, opts?: unknown): Promise<void>`,
						`	export function preloadData(url: string): Promise<unknown>`,
						`	export function preloadCode(url: string): Promise<unknown>`,
						`	export function pushState(url: string, state?: unknown): Promise<void>`,
						`	export function replaceState(url: string, state?: unknown): Promise<void>`,
						`	export function captureSnapshot(fn: unknown): () => void`,
						`	export function restoreSnapshot(fn: unknown): () => void`,
						`	export function beforeNavigate(fn: unknown): () => void`,
						`	export function afterNavigate(fn: unknown): () => void`,
						`	export function onNavigate(fn: unknown): () => void`,
						`	export function checkUpdated(): Promise<boolean>`,
						`	export function handleFetch(fn: unknown): () => void`,
						`	export function swelteError(status: number, message: string): unknown`,
						`	export function isRedirect(e: unknown): boolean`,
						`}`,
						``
					)
					writeIfChanged(join(genDir, 'v-shim.d.ts'), decls.join('\n'))
				}
				// Roadmap §1.5 + §1.9: virtual `#app/paths` + `#app/environment`
				// modules and the version stamp — generated from loadConfig()
				// (SvelteKit `$app/*` equivalent, build-time constants, no V side).
				{
					// Version falls back to package.json (SvelteKit `version` equivalent).
					if (appVersion === '') {
						try {
							const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
								version?: unknown
							}
							if (typeof pkg.version === 'string') appVersion = pkg.version
						} catch {
							/* no package.json version */
						}
					}
					const esc = (s: string) => JSON.stringify(s)
					writeIfChanged(
						join(genDir, 'paths.js'),
						`// Auto-generated by swelte. Do not edit.\nexport const base = ${esc(appBase)};\nexport const assets = ${esc(appAssets)};\n`
					)
					writeIfChanged(
						join(genDir, 'paths.d.ts'),
						`// Auto-generated by swelte. Do not edit.\nexport declare const base: string\nexport declare const assets: string\n`
					)
					writeIfChanged(
						join(genDir, 'environment.js'),
						`// Auto-generated by swelte. Do not edit.\nexport const browser = typeof window !== 'undefined';\nexport const dev = ${process.env.NODE_ENV === 'production' ? 'false' : 'true'};\nexport const building = false;\nexport const version = ${esc(appVersion)};\n`
					)
					writeIfChanged(
						join(genDir, 'environment.d.ts'),
						`// Auto-generated by swelte. Do not edit.\nexport declare const browser: boolean\nexport declare const dev: boolean\nexport declare const building: boolean\nexport declare const version: string\n`
					)
					writeIfChanged(
						join(genDir, 'version.js'),
						`// Auto-generated by swelte. Do not edit.\nexport const version = ${esc(appVersion)};\nexport const buildTime = ${esc(new Date().toISOString())};\n`
					)
				}
				// SvelteKit `$app` stubs, exact IDs only (re-export @swelte/core stores/router).
				// `$app/stores` + `$app/state` (stores), `$app/navigation` (router fns),
				// Aliased in resolve.alias below; declared in v-shim.d.ts above.
				{
					const appDir = join(genDir, 'app')
					mkdirSync(appDir, { recursive: true })
					// `$app` compat stubs, exact IDs only (no `$app/forms`/`$app/server`, no `$env/*`; unknown IDs fail the build — no TS server exists).
					// JS bodies inlined via JSON.stringify (no quote-escaping
					// hazards); the .d.ts bundle comes from renderAppDts().
					const GEN_STORES_JS = `// Auto-generated by swelte. Do not edit.
export { page, navigating, updated } from '@swelte/core'
`
					const GEN_NAV_JS = `// Auto-generated by swelte. Do not edit.
export { goto, preloadData, preloadCode, pushState, replaceState, captureSnapshot, restoreSnapshot, beforeNavigate, afterNavigate, onNavigate, checkUpdated, handleFetch, swelteError, isRedirect } from '@swelte/core'
`
					const GEN_ENV_JS = `// Auto-generated by swelte. Do not edit.
export const browser = typeof window !== 'undefined';
export const dev = true;
`
					const GEN_ENV_DTS = `// Auto-generated by swelte. Do not edit.
export declare const browser: boolean
export declare const dev: boolean
`
					writeIfChanged(join(appDir, 'stores.js'), GEN_STORES_JS)
					writeIfChanged(join(appDir, 'state.js'), GEN_STORES_JS)
					writeIfChanged(join(appDir, 'navigation.js'), GEN_NAV_JS)
					writeIfChanged(join(appDir, 'stores.d.ts'), renderAppDts())
					writeIfChanged(join(appDir, 'state.d.ts'), renderAppDts())
					writeIfChanged(join(appDir, 'navigation.d.ts'), renderAppDts())
					writeIfChanged(join(appDir, 'environment.js'), GEN_ENV_JS)
					writeIfChanged(join(appDir, 'environment.d.ts'), GEN_ENV_DTS)
				}
				for (const w of warnings) console.warn(`[swelte] ${w}`)
				// Roadmap 7: client router — UI composition without manual imports.
				// (extracted: `emitClientRouter` in `./client-router.js` builds the
				// `routes.js` lines + chunk map; generate() owns the disk writes.)
				try {
					const router = emitClientRouter({
						routesAbs,
						routesDir,
						dispatched,
						routeFiles,
						vMods,
						matchers,
						appChunking,
					})
					if (router.chunks) {
						writeIfChanged(
							join(genDir, 'chunks.json'),
							JSON.stringify({ mode: router.chunks.mode, chunks: router.chunks.chunks }, null, 2) +
								'\n'
						)
					} else {
						try {
							rmSync(join(genDir, 'chunks.json'), { force: true })
						} catch {
							/* ignore */
						}
					}
					writeIfChanged(join(genDir, 'routes.js'), router.lines.join('\n'))
				} catch (e) {
					console.warn(`[swelte] routes.js emit failed: ${(e as Error).message}`)
				}
				const { entries: svelteEntries, hasError } = collectSvelteManifest(
					routesAbs,
					routesDir,
					vMods
				)
				// Wrapper chain per page svelte path (root-first), same
				// candidate rule as routes.js (nearest +route.svelte per
				// ancestor dir). Keyed by manifest svelte path.
				const wrapperSet = new Set(
					svelteEntries.filter((e) => e.kind === 'wrapper').map((e) => e.svelte)
				)
				// Layout composition (`export const layout` in the sibling
				// `.ts`, resolved per leaf at manifest time — mirrors
				// routes.js cutWrappers).
				const chainFor = (pageSvelte: string): string[] => {
					const mod = pageSvelte.replace(/\.svelte$/, '')
					const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
					const cut = svelteEntries.find((e) => e.svelte === pageSvelte)?.layout ?? null
					const dirOfW = (w: string): string =>
						w.endsWith('/+route.svelte')
							? w.slice(0, -'/+route.svelte'.length)
							: w === '+route.svelte'
								? ''
								: w
					const chain: string[] = []
					let cur = dir
					for (;;) {
						const cand = `${cur === '' ? '+route' : `${cur}/+route`}.svelte`
						if (wrapperSet.has(cand)) chain.unshift(cand)
						if (cur === '') break
						cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''
					}
					if (cut === false) return []
					if (cut === null || cut === true) return chain
					const idx = chain.findIndex((w) => dirOfW(w) === cut)
					// resolveLayoutHint already rejected non-ancestor dirs, so a
					// miss here can only mean the wrapper set changed under us.
					if (idx < 0) return []
					return chain.slice(0, idx + 1)
				}
				const wrappersByRoute: Record<string, string[]> = {}
				for (const e of svelteEntries) {
					if (e.kind === 'wrapper' || e.kind === 'error') continue
					const chain = chainFor(e.svelte)
					if (chain.length) wrappersByRoute[`./${e.svelte}`] = chain.map((w) => `./${w}`)
				}
				const manifest = {
					hasError,
					routes: svelteEntries
						.filter((e) => e.kind !== 'wrapper' && e.kind !== 'error')
						.map((e) => ({
							route: e.route,
							svelte: e.svelte,
							kind: e.kind,
							hasData: e.hasData,
							hasUniversalLoad: e.hasUniversalLoad,
							ssr: e.ssr,
							csr: e.csr,
							limits: e.limits ?? null,
							serializedHeaders: e.serializedHeaders ?? null,
							layout: e.layout ?? null,
							chunk: e.chunk ?? 'inherit',
							prerender: e.prerender ?? 'inherit',
						}))
						.sort((a, b) => a.route.localeCompare(b.route)),
					error: svelteEntries.some((e) => e.kind === 'error')
						? (svelteEntries.find((e) => e.kind === 'error')?.svelte ?? null)
						: null,
					wrappers: svelteEntries
						.filter((e) => e.kind === 'wrapper')
						.map((e) => e.svelte)
						.sort(),
					wrappersByRoute,
				}
				writeIfChanged(join(genDir, 'ssr-manifest.json'), JSON.stringify(manifest, null, 2))
				const crawl = await collectPrerenderEntries(
					root,
					routesDir,
					appPrerender.entries,
					knownMatchers
				)
				writeIfChanged(join(genDir, 'entries.json'), JSON.stringify(crawl, null, 2))
				writeIfChanged(join(genDir, 'sdk.ts'), '// Auto-generated by swelte. Do not edit.\n')
				// Plugin V module dirs (e.g. `@swelte/plus/db` → `backend/`):
				// copied into the `.swelte/` compilation unit so generated
				// routes/harness can `import <module>`. Source of truth stays
				// in the plugin package; core only copies `*.v`. Missing dirs
				// skipped (TS-only install); stale module dirs pruned.
				const wanted = new Set<string>()
				try {
					for (const pp of plugins) {
						let incs: { module: string; absDir: string }[] = []
						try {
							incs = pp.includes?.() ?? []
						} catch {
							/* plugin include probe failed — skip */
						}
						for (const inc of incs) {
							if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inc.module)) {
								warnings.push(`plugin ${pp.name}: bad include module '${inc.module}' — skipped`)
								continue
							}
							if (inc.module === 'routes' || inc.module === 'main') {
								warnings.push(
									`plugin ${pp.name}: include module '${inc.module}' reserved — skipped`
								)
								continue
							}
							let files: string[] = []
							try {
								files = readdirSync(inc.absDir).filter((f) => f.endsWith('.v'))
							} catch {
								continue
							}
							wanted.add(inc.module)
							const dest = join(genDir, inc.module)
							mkdirSync(dest, { recursive: true })
							for (const f of files) {
								try {
									const src = readFileSync(join(inc.absDir, f), 'utf8')
									writeIfChanged(join(dest, f), src)
								} catch {
									/* unreadable file — skip */
								}
							}
						}
					}
					// Prune stale plugin module dirs (renamed/removed includes).
					// `qjs/` is adapter-owned (ssr-qjs archive lives here) —
					// never prune it: the QJS-bridge-pass regenerate runs
					// AFTER vite build created the archive.
					const ADAPTER_OWNED_DIRS = new Set(['qjs'])
					try {
						for (const e of readdirSync(genDir, { withFileTypes: true })) {
							if (!e.isDirectory()) continue
							if (SWELTE_GEN_CORE_DIRS.includes(e.name)) continue
							if (ADAPTER_OWNED_DIRS.has(e.name)) continue
							if (e.name.startsWith('.')) continue
							if (!wanted.has(e.name)) {
								try {
									rmSync(join(genDir, e.name), { recursive: true, force: true })
								} catch {
									/* ignore */
								}
							}
						}
					} catch {
						/* ignore */
					}
				} catch (e) {
					warnings.push(`plugin includes: ${(e as Error).message}`)
				}
				// Server harness: verbatim skeleton from templates/ (node_modules),
				// rendered into `.swelte/server.v`. `dev`/`build` compile `.swelte/`
				// as one V unit (harness `module main` + `routes/` + `server_gen.v`).
				// Plugin module marker: which `includes` were copied (build/dev
				// read it for `-enable-globals` — `__global` in plugin modules
				// needs the flag exactly like the QJS bridge does).
				try {
					writeIfChanged(join(genDir, 'plugin_modules.json'), JSON.stringify([...wanted].sort()))
				} catch {
					/* ignore */
				}
				try {
					const cfg = await loadConfig(root)
					const pluginHarness = [
						...plugins.map((pp) => pp.harness?.({})).filter((h) => h !== undefined),
						...appHookFragments,
					]
					writeIfChanged(
						join(genDir, 'server.v'),
						renderHarness(
							cfg,
							import.meta.url,
							{
								startupBody: hooks.startupBody,
								rerouteBody: hooks.rerouteBody,
								errorBody: hooks.errorBody,
								roomSse: hasRoomSse,
							},
							pluginHarness
						)
					)
				} catch (e) {
					warnings.push(`harness: ${(e as Error).message}`)
				}
				// Client entry (engine-owned, like .swelte/server.v):
				// templates/client/main.ts → .swelte/entry-main.ts, plus the
				// inverted user-setup imports from renderClientEntry
				// (src/app.ts as ../src/app.js, src/app.css when present).
				// routes.js is
				// untyped JS: user `tsc --strict` would infer the
				// defaulted `errorProps` param as required, so emit an
				// adjacent .d.ts declaring it optional.
				try {
					writeIfChanged(join(genDir, 'entry-main.ts'), renderClientEntry(root, import.meta.url))
					writeIfChanged(
						join(genDir, 'entry-main.d.ts'),
						'// Auto-generated by swelte. Do not edit.\n' +
							"declare module './routes.js' {\n" +
							'\texport function mountSwelteRoute(target: Element, pathname: string, errorProps?: unknown): Promise<{ params: Record<string, string>; path: string | null }>\n' +
							'\texport function hydrateSwelteRoute(target: Element, pathname: string, errorProps?: unknown): Promise<{ params: Record<string, string>; path: string | null; hydrated: boolean }>\n' +
							'\texport function initSwelteRouter(target: Element | null): () => void\n' +
							'}\n'
					)
				} catch (e) {
					warnings.push(`entry: ${(e as Error).message}`)
				}
			})()
		)
		genChain = run.catch(() => {})
		return run
	}

	const plugin: Plugin = {
		name: 'swelte',
		// Run before vite-plugin-svelte so `.v` ids resolve before the
		// Svelte compiler requests them (Svelte emits relative `.v`
		// imports verbatim; our load() codegens the JS).
		enforce: 'pre',
		config(userConfig, env) {
			isBuild = (env as { command?: string } | undefined)?.command === 'build'
			// Env wins at runtime AND at build time for the SW gate: SWELTE_SW=1
			// forces the additive dist/sw.js emit without touching config.
			if (process.env.SWELTE_SW === '1') appSw.enabled = true
			// Resolve dirs against the Vite root (not process.cwd()) — the
			// language server loads vite.config.ts with cwd elsewhere.
			const root = (userConfig && (userConfig as { root?: string }).root) || process.cwd()
			const routesAbs = resolve(root, routesDir)
			const libAbs = resolve(root, libDir)
			// Chunking build config: `single` leaves Vite defaults; `layout`/`route`
			// group the generated dynamic imports by chunk key (`.swelte/` +
			// `chunks.json`, written by generate() before the bundle runs) so
			// one layout subtree (or one leaf) ships in one file. Bare
			// `import()` already cuts the graph per file; without
			// `manualChunks` Vite keeps every leaf in its own chunk
			// (waterfall inside a layout). CSS follows JS via cssCodeSplit
			// (Vite default true; never turn it off or chunk cuts diverge
			// from CSS).
			const chunkBuild = {
				cssCodeSplit: true,
				rollupOptions: {
					output: {
						manualChunks(id: string) {
							return swelteManualChunk(swelteChunkGroup(root), id) ?? undefined
						},
					},
				},
			}
			return {
				...(chunkBuild ? { build: chunkBuild } : {}),
				resolve: {
					alias: [
						{ find: '#routes', replacement: routesAbs },
						{ find: '#lib', replacement: libAbs },
						{ find: '#app/paths', replacement: join(resolve(root, outDir), 'paths.js') },
						{
							find: '#app/environment',
							replacement: join(resolve(root, outDir), 'environment.js'),
						},
						{
							find: '$app',
							replacement: join(resolve(root, outDir), 'app'),
						},
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
			// Entry script already points at the generated client entry
			// (.swelte/entry-main.ts, engine-owned), which pulls user setup
			// in via renderClientEntry (src/app.ts + src/app.css). Legacy
			// projects still referencing the old /src/main.ts or /src/app.ts
			// shims get rewritten to the generated entry; custom entries
			// are left alone.
			let out = html
			for (const legacy of ['/src/main.ts', '/src/app.ts']) {
				if (out.includes(legacy)) out = out.replaceAll(legacy, '/.swelte/entry-main.ts')
			}
			// SSR markers: Hand fills <!--ssr-head-->/<!--ssr-body--> when a
			// renderer answers. Inject them into the #app host when absent
			// (source index.html keeps them; whatever shell the app ships
			// may not, so this stays idempotent for both).
			if (!out.includes('<!--ssr-body-->') && out.includes('<div id="app">')) {
				out = out.replace('<div id="app">', '<div id="app"><!--ssr-body-->')
			}
			if (!out.includes('<!--ssr-head-->') && out.includes('</head>')) {
				out = out.replace('</head>', '<!--ssr-head--></head>')
			}
			// CSP knob (SvelteKit `csp` equivalent): configured value ships
			// as a meta tag so static + SSR shells enforce it without a
			// server header change. Skipped when unset (today's behavior).
			// Closure over the generate()-resolved value — `this` is the
			// Vite plugin context here, not our closure.
			{
				const csp = String(appCsp ?? '')
				if (csp !== '' && !out.includes('http-equiv="Content-Security-Policy"')) {
					const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`
					if (out.includes('</head>')) out = out.replace('</head>', `${tag}</head>`)
					else out = `${tag}${out}`
				}
			}
			// Service worker registration (opt-in, additive): when enabled and
			// register mode is auto, inject the same-origin register snippet.
			// `manual` emits dist/sw.js but skips the snippet (app registers).
			// Default off — no SW bytes, no registration, SPA-first unchanged.
			if (
				appSw.enabled === true &&
				appSw.register !== 'manual' &&
				!out.includes('serviceWorker.register') &&
				!out.includes('/sw.js')
			) {
				const snippet = renderServiceWorkerRegister(appBase)
				if (out.includes('</body>')) out = out.replace('</body>', `${snippet}</body>`)
				else out = `${out}${snippet}`
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
				let routeMatchers: Map<string, MatcherDef> | undefined
				try {
					routeMatchers = loadMatchers(root)
				} catch {
					routeMatchers = undefined
				}
				const route = routeFor(
					routesDir,
					routesAbs,
					abs,
					routeMatchers ? new Set(routeMatchers.keys()) : undefined
				)
				if (route === null) {
					throw new Error(
						`[swelte] ${abs} is a +route.v wrapper (@[before]/@[after] middleware only) and cannot be imported in browser code.`
					)
				}
				const fns = parseVFile(src, extraAttrs).filter(
					(x) => x.attr !== 'before' && x.attr !== 'after' && x.attr !== 'load'
				)
				if (fns.length === 0) return 'export {}; // swelte: no RPC fns in this .v file'
				return jsFetchFor(route, fns, trailingSlash, routeMatchers)
			}
			if (norm === libNorm || norm.startsWith(`${libNorm}/`)) {
				const mod = modulePath(libAbs, abs)
				if (isBackendMod(mod)) {
					throw new Error(
						`[swelte] ${abs} is backend-only (#lib/backend) and cannot be imported in browser code.`
					)
				}
				const rpcFns = parseVFile(src, extraAttrs).filter((x) => x.attr === 'rpc')
				const verbFns = parseVFile(src, extraAttrs).filter(
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
				// HMR loop guard: generate() emits .v dispatchers under
				// <outDir>/routes/ (*.v suffix). Vite watches the whole root,
				// so our own output re-enters this handler → generate() →
				// rewrites → events → … a self-sustaining loop with phantom
				// HMR updates + page reloads and "nothing changing".
				// Only user sources (routesDir/libDir) may trigger regen.
				const norm = file.split(sep).join('/')
				const outNorm = resolve(server.config.root, outDir).split(sep).join('/')
				if (norm === outNorm || norm.startsWith(`${outNorm}/`)) return
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
					const virt = `\0swelte:v:${file.split('?')[0]}`
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
							const fp = join(devWasmDirFor(server.config.root), `${mod}.wasm`)
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
							const isAsset =
								url.pathname.startsWith('/@') ||
								url.pathname.startsWith('/src/') ||
								url.pathname.startsWith('/node_modules/') ||
								url.pathname.includes('/.') ||
								/\.(?:js|ts|css|map|json|wasm|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|html)(?:$|\?)/.test(
									url.pathname
								)
							const isRpc = url.pathname === '/' || url.pathname.startsWith('/api/') || !isAsset
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
								((req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') &&
									accept.includes('application/json')) ||
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
								// No-JS forms: Hand answers POST with 303 + Location.
								// Node fetch follows redirects by default, which would
								// consume the 303 (turning it into the GET body the
								// browser then renders as a full-page answer). Preserve
								// the redirect so the browser navigates itself.
								redirect: 'manual',
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
			// Production WASM bundle first (`v -b wasm` → dist/assets/app_lib-*.wasm):
			// its hashed name is captured below for the SW precache (item 14 —
			// the wasm `emitFile` lands too late for the bundle scan to see it).
			let wasmAsset: string | null = null
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
					if (!parseVFile(src, extraAttrs).some((x) => x.attr === 'rpc')) continue
					mods.push(mod)
					bodies.push(src)
				}
				if (mods.length > 0) {
					const seenFns = new Set<string>()
					const parts: string[] = []
					for (let i = 0; i < mods.length; i++) {
						const mod = mods[i]
						const src = bodies[i]
						for (const fn of parseVFile(src, extraAttrs).filter((x) => x.attr === 'rpc')) {
							if (seenFns.has(fn.name))
								throw new Error(`WASM bundle: duplicate fn ${fn.name} (in ${mod}.v)`)
							seenFns.add(fn.name)
							for (const p of fn.params) {
								if (wasmParamKind(p.vtype) === null)
									throw new Error(`${libDir}/${mod}.v: ${fn.name} unsupported param`)
							}
							if (fn.fallible) throw new Error(`${libDir}/${mod}.v: ${fn.name} is fallible`)
							if (wasmReturnKind(fn.vret) === null)
								throw new Error(`${libDir}/${mod}.v: ${fn.name} unsupported return`)
						}
						const blocked = wasmBlockedImports(src)
						if (blocked.length > 0)
							throw new Error(`${libDir}/${mod}.v: blocked import(s): ${blocked.join(', ')}`)
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
									return keep.length > 0 ? `@[${keep.join('; ')}] ` : ''
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
					writeIfChanged(tmpEntry, entry)
					try {
						const tmpWasm = join(resolve(root, outDir), `.${prodWasmName}`)
						if (!vBin) vBin = resolveV(import.meta.url)
						execVSync(vBin, ['-b', 'wasm', '-os', 'browser', '-o', tmpWasm, tmpEntry], {
							stdio: ['ignore', 'pipe', 'pipe'],
						})
						const bytes = readFileSync(tmpWasm)
						const ref = this.emitFile({ type: 'asset', name: prodWasmName, source: bytes })
						const fileName = this.getFileName(ref)
						wasmAsset = fileName.startsWith('/') ? fileName : `/${fileName}`
						// Bundle name map (stays in .swelte/, never emitted):
						// fn -> source module for trap resolution.
						writeIfChanged(
							join(resolve(root, outDir), 'app_lib.wasm.map'),
							JSON.stringify(
								{
									modules: mods.map((mod, i) => ({
										mod,
										file: `${libDir}/${mod}.v`,
										functions: parseVFile(bodies[i], extraAttrs)
											.filter((x) => x.attr === 'rpc')
											.map((f) => f.name),
									})),
								},
								null,
								2
							)
						)
						for (const [id, info] of Object.entries(bundle)) {
							if (
								id.endsWith('.js') &&
								info.type === 'chunk' &&
								info.code.includes(`/assets/${prodWasmName}`)
							) {
								info.code = info.code.split(`/assets/${prodWasmName}`).join(`/${fileName}`)
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
			// Service worker emit (opt-in, additive): dist/sw.js only. Never
			// changes the single-artifact default — off means zero SW bytes.
			// Runs AFTER the wasm emit above; the hashed app_lib-*.wasm name
			// is pushed explicitly since the bundle scan can't see the late
			// wasm emit (item 14).
			try {
				if (appSw.enabled === true) {
					const precache = serviceWorkerPrecache(
						bundle as unknown as Record<string, { type?: string; fileName?: string }>
					)
					if (wasmAsset !== null && !precache.includes(wasmAsset)) precache.push(wasmAsset)
					// Offline fallback page (item 5): only precached when
					// configured AND the prerender pass wrote it. Shell +
					// immutable assets stay cached; API/SSE network-only.
					if (appOffline.fallback !== 'off') {
						try {
							const fb = appOffline.fallback.replace(/^\/+/, '')
							if (existsSync(join(root, 'dist', fb))) precache.push(`/${fb}`)
						} catch {
							/* best-effort */
						}
					}
					const sw = renderServiceWorker({ version: appVersion, precache, base: appBase })
					this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw })
					console.log(`[swelte] service worker: dist/sw.js (+${precache.length} precache)`)
				}
			} catch (e) {
				console.warn(`[swelte] service worker emit failed: ${(e as Error).message}`)
			}
			void _opts
			void bundle
		},
	}
	// The CLI (`swelte build`/`dev`/`test`) never loads vite.config.ts,
	// so its manual generate() passes would run with empty options
	// (no plugins → backend-hub build errors). Stash the options
	// non-enumerably for loadProjectSwelteOptions() (gen/config.ts).
	Object.defineProperty(plugin, '__swelteOptions', { value: options, enumerable: false })
	return plugin
}
