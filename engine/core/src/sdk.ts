// Swelte client runtime. No back-compat: the only user API is importing
// `.v` files (codegen calls __swelteFetch / __swelteWasmCall).
// Direct sdk.post/get/worker usage was removed with self/$ssapi/$csapi.

export type ArgValue =
	| string
	| number
	| boolean
	| File
	| Blob
	| Array<string | number | boolean | File | Blob>
export type Args = Record<string, ArgValue>

export interface SwelteErrorShape {
	error: string
	fn?: string
	path?: string
	available?: string[]
	hint?: string
	[key: string]: unknown
}

export class SwelteRpcError extends Error {
	status: number
	body: SwelteErrorShape | null
	base: string
	fn: string

	constructor(
		base: string,
		fn: string,
		status: number,
		body: SwelteErrorShape | null,
		raw: string
	) {
		const avail = body?.available?.length ? ` — available: ${body.available.join(', ')}` : ''
		const hint = body?.hint ? ` — ${body.hint}` : ''
		super(
			`swelte: "${fn}" on ${base} failed (HTTP ${status}): ${body?.error ?? raw}${avail}${hint}`
		)
		this.name = 'SwelteRpcError'
		this.status = status
		this.body = body
		this.base = base
		this.fn = fn
	}
}

// Client-side mirror of the V `SwelteResponse` envelope (see `docs/types.md`).
// Verbs returning `SwelteResponse` (or the `(int, string)` sugar, which
// projects to the same `tsret`) resolve this envelope — NOT the decoded
// body: `{ status, headers, cookies, body }`, where `body` is the raw text
// for JSON/text responses and a `Blob` otherwise. Value verbs (plain
// `string`/struct/`[]u8` returns) keep the old behavior: the decoded body
// directly (`json()` / `text()` / `blob()` by content-type).
export interface SwelteCookie {
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

async function decodeEnvelope(res: Response): Promise<SwelteResponse> {
	const ct = (res.headers.get('content-type') ?? '').toLowerCase()
	const headers: Record<string, string> = {}
	res.headers.forEach((v, k) => {
		headers[k] = v
	})
	// Mirror decodeBody's content-type branches, but keep the envelope:
	// text for JSON/text (never res.json() — the caller parses), Blob for
	// binary. Set-Cookie is never visible to fetch — cookies stays [].
	if (ct.startsWith('text/') || ct.includes('json') || ct === '') {
		return { status: res.status, headers, cookies: [], body: await res.text(), is_bytes: false }
	}
	return { status: res.status, headers, cookies: [], body: await res.blob(), is_bytes: true }
}

async function throwForStatus(base: string, fn: string, res: Response): Promise<never> {
	let raw = ''
	let body: SwelteErrorShape | null = null
	try {
		raw = await res.text()
	} catch {
		/* ignore */
	}
	try {
		body = JSON.parse(raw) as SwelteErrorShape
	} catch {
		/* not JSON */
	}
	// HTML shell instead of JSON (preview served dist/index.html for an RPC
	// GET): surface a hint instead of a bare `Unexpected token <` downstream.
	if (!body && /^\s*<!doctype html|^\s*<html/i.test(raw)) {
		throw new SwelteRpcError(
			base,
			fn,
			res.status,
			{
				error: 'got HTML shell instead of JSON (route served dist/index.html)',
			} as SwelteErrorShape,
			raw.slice(0, 200)
		)
	}
	throw new SwelteRpcError(base, fn, res.status, body, raw)
}

function encodeQuery(args: object): string {
	const params = new URLSearchParams()
	for (const [k, v] of Object.entries((args ?? {}) as Record<string, unknown>)) {
		if (v === undefined || v === null) continue
		params.set(k, typeof v === 'string' ? v : JSON.stringify(v))
	}
	const s = params.toString()
	return s ? `?${s}` : ''
}

async function decodeBody<TResult>(base: string, fn: string, res: Response): Promise<TResult> {
	const ct = (res.headers.get('content-type') ?? '').toLowerCase()
	if (ct.includes('application/json') || ct === '') return res.json()
	if (ct.startsWith('text/') || ct.includes('json')) return (await res.text()) as unknown as TResult
	return (await res.blob()) as unknown as TResult
}

async function postJson<TResult>(
	base: string,
	fn: string,
	args: object,
	envelope = false
): Promise<TResult> {
	const res = await fetch(base, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({ fn, args: args ?? {} }),
	})
	if (!res.ok) return throwForStatus(base, fn, res)
	if (envelope) return (await decodeEnvelope(res)) as unknown as TResult
	return decodeBody<TResult>(base, fn, res)
}

async function getVerb<TResult>(
	base: string,
	fn: string,
	method: string,
	qualifier: string,
	args: object,
	envelope = false
): Promise<TResult> {
	const q = qualifier ? `?q=${encodeURIComponent(qualifier)}` : ''
	const res = await fetch(`${base}${q}${encodeQuery(args ?? {}).replace(/^\?/, q ? '&' : '?')}`, {
		method,
		headers: { accept: 'application/json' },
	})
	if (!res.ok) return throwForStatus(base, fn, res)
	if (envelope) return (await decodeEnvelope(res)) as unknown as TResult
	return decodeBody<TResult>(base, fn, res)
}

async function postForm<TResult>(
	base: string,
	fn: string,
	method: string,
	qualifier: string,
	args: object,
	envelope = false
): Promise<TResult> {
	const q = qualifier ? `?q=${encodeURIComponent(qualifier)}` : ''
	// §13 uploads: File/Blob values go multipart (browser sets the boundary);
	// plain values stay urlencoded. Server reads filenames from req.files.
	const entries = Object.entries((args ?? {}) as Record<string, unknown>)
	const hasFile = entries.some(
		([, v]) =>
			v instanceof File ||
			v instanceof Blob ||
			(Array.isArray(v) && v.some((x) => x instanceof File || x instanceof Blob))
	)
	if (hasFile) {
		const fd = new FormData()
		for (const [k, v] of entries) {
			if (v === undefined || v === null) continue
			if (Array.isArray(v)) {
				for (const x of v) fd.append(k, x instanceof File || x instanceof Blob ? x : String(x))
			} else
				fd.append(
					k,
					v instanceof File || v instanceof Blob ? v : typeof v === 'string' ? v : JSON.stringify(v)
				)
		}
		const res = await fetch(`${base}${q}`, {
			method,
			headers: { accept: 'application/json' },
			body: fd,
		})
		if (!res.ok) return throwForStatus(base, fn, res)
		if (envelope) return (await decodeEnvelope(res)) as unknown as TResult
		return res.json()
	}
	const params = new URLSearchParams()
	for (const [k, v] of entries) {
		if (v === undefined || v === null) continue
		params.set(k, typeof v === 'string' ? v : JSON.stringify(v))
	}
	const res = await fetch(`${base}${q}`, {
		method,
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
		body: params.toString(),
	})
	if (!res.ok) return throwForStatus(base, fn, res)
	if (envelope) return (await decodeEnvelope(res)) as unknown as TResult
	return decodeBody<TResult>(base, fn, res)
}

/**
 * Internal fetch for code-generated `#routes/*.v` stubs (spec v-imports.md §4).
 * kind 'rpc' → POST JSON `{fn,args}`; verbs → method + `?q` qualifier for
 * non-default handlers (GET query / form POST). Content-Type decides the
 * server branch: JSON → rpc, form → verb dispatch.
 * Not user API — import the `.v` file instead.
 */
export async function __swelteFetch<TResult>(
	base: string,
	fn: string,
	kind: 'rpc' | 'get' | 'post' | 'put' | 'delete' | 'patch',
	args: object = {},
	qualifier = '',
	envelope = false
): Promise<TResult> {
	if (kind === 'rpc') return postJson<TResult>(base, fn, args, envelope)
	if (kind === 'get' || kind === 'put' || kind === 'delete' || kind === 'patch') {
		return getVerb<TResult>(base, fn, kind.toUpperCase(), qualifier, args, envelope)
	}
	return postForm<TResult>(base, fn, 'POST', qualifier, args, envelope)
}

/**
 * Internal SSE reader for code-generated `@[sse]` stubs (roadmap §14,
 * veb streaming). GETs `base` with `Accept: text/event-stream` and
 * yields each `data:` frame as it arrives (true incremental flush —
 * the server `send_message`s per event). `swelte:close` ends the
 * stream. Non-2xx throws SwelteRpcError via throwForStatus (JSON).
 * Not user API — import the `.v` file instead.
 */
export async function* __swelteStream(
	base: string,
	fn: string,
	args: object = {},
	qualifier = '',
	opts: { signal?: AbortSignal; lastEventId?: string } = {}
): AsyncGenerator<string, void, void> {
	const q = qualifier ? `?q=${encodeURIComponent(qualifier)}` : ''
	const url = `${base}${q}${encodeQuery(args ?? {}).replace(/^\?/, q ? '&' : '?')}`
	const headers: Record<string, string> = { accept: 'text/event-stream' }
	if (opts.lastEventId) headers['last-event-id'] = opts.lastEventId
	const res = await fetch(url, { headers, signal: opts.signal })
	if (!res.ok) return throwForStatus(base, fn, res)
	if (!res.body) return
	const reader = res.body.getReader()
	const dec = new TextDecoder()
	let buf = ''
	for (;;) {
		const { done, value } = await reader.read()
		if (value) buf += dec.decode(value, { stream: !done })
		for (;;) {
			const idx = buf.indexOf('\n\n')
			if (idx < 0) break
			const frame = buf.slice(0, idx)
			buf = buf.slice(idx + 2)
			let data = ''
			for (const line of frame.replace(/\r\n/g, '\n').split('\n')) {
				if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '')
			}
			if (data === 'swelte:close') return
			if (data !== '') yield data
		}
		if (done) {
			const tail = buf.trim()
			if (tail.startsWith('data:')) {
				const data = tail.slice(5).replace(/^ /, '')
				if (data !== '' && data !== 'swelte:close') yield data
			}
			return
		}
	}
}

// Dev fallback registry for `#lib/*.v` when a WASM artifact is missing
// (uncompiled file, pruned module). Keyed by bare fn name. Production
// WASM modules bypass the registry entirely.
type LibHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>
const libFallbacks = new Map<string, LibHandler>()

export function __registerLibFallback(fn: string, handler: LibHandler): void {
	libFallbacks.set(fn, handler)
}

function strArg(args: Record<string, unknown>, key: string): string {
	const v = args[key]
	return typeof v === 'string' ? v : String(v ?? '')
}

// Built-in dev fallback: hash_string mirrors src/lib/**/*.v so pages
// render before `v -b wasm` runs (dev generate() compiles async-safe).
__registerLibFallback('hash_string', (args) => `hash(${strArg(args, 'input')})`)

type WasmParam = { name: string; kind: 'string' | 'int' | 'bool' | 'unsupported'; vtype: string }
type WasmExports = {
	memory: WebAssembly.Memory
	swelte_alloc: (n: number) => number
	[k: string]: WebAssembly.ExportValue
}
const wasmInstances = new Map<string, Promise<WasmExports>>()

function wasmEnv(memory: () => WebAssembly.Memory | undefined): WebAssembly.Imports {
	return {
		env: {
			__panic_abort: (ptr: number, len: number) => {
				const mem = memory()
				const msg = mem
					? new TextDecoder().decode(new Uint8Array(mem.buffer, ptr, len))
					: 'wasm panic'
				throw new Error(msg)
			},
			__writeln: () => {
				/* V println inside wasm — drop (no console spam) */
			},
		},
	}
}

async function loadWasm(url: string): Promise<WasmExports> {
	let inst = wasmInstances.get(url)
	if (!inst) {
		inst = (async () => {
			let mem: WebAssembly.Memory | undefined
			const res = await fetch(url)
			if (!res.ok) throw new Error(`WASM fetch ${url}: HTTP ${res.status}`)
			const { instance } = await WebAssembly.instantiateStreaming(
				res,
				wasmEnv(() => mem)
			)
			mem = instance.exports.memory as WebAssembly.Memory
			if (!mem || typeof (instance.exports.swelte_alloc as unknown) !== 'function') {
				throw new Error(`WASM ${url}: missing memory/swelte_alloc exports`)
			}
			return instance.exports as unknown as WasmExports
		})()
		wasmInstances.set(url, inst)
	}
	return inst
}

/**
 * Internal WASM caller for code-generated `#lib/*.v` stubs
 * (spec v-imports.md §4). Proven ABI (V 0.5.2, `v -b wasm -os browser`):
 * numerics are i32 params/returns; strings marshal as `{data ptr, len
 * i32}` structs — params as ONE i32 pointer to the struct, returns via
 * a caller-allocated hidden out-pointer passed FIRST (`fn(rp, ...args)`
 * → `undefined`, result read from `rp`). `!T`/`?T` cannot compile on
 * the wasm backend (rejected at build); a wasm trap surfaces here as
 * SwelteRpcError(status 0).
 */
export async function __swelteWasmCall<TResult>(
	wasmUrl: string,
	fn: string,
	args: object = {},
	params: WasmParam[] = [],
	retKind: 'string' | 'int' | 'bool' | 'void' | 'unsupported' = 'unsupported'
): Promise<TResult> {
	const bare = fn.includes('.') ? (fn.split('.').pop() as string) : fn
	const fallback = libFallbacks.get(bare)
	const fail = (detail: string): TResult => {
		throw new SwelteRpcError(wasmUrl, bare, 0, { error: detail, fn: bare, path: wasmUrl }, '')
	}
	try {
		const ex = await loadWasm(wasmUrl)
		const target = ex[fn] ?? ex[bare]
		if (typeof target !== 'function') {
			if (fallback)
				return Promise.resolve(fallback((args ?? {}) as Record<string, unknown>) as TResult)
			const available = Object.keys(ex).filter((k) => k !== 'memory' && k !== 'swelte_alloc')
			throw new SwelteRpcError(
				wasmUrl,
				bare,
				0,
				{ error: 'unknown fn', fn: bare, path: wasmUrl, available },
				''
			)
		}
		const call = target as (...a: number[]) => number | undefined
		const mem = () => new Uint8Array(ex.memory.buffer)
		const dv = () => new DataView(ex.memory.buffer)
		const enc = new TextEncoder()
		const dec = new TextDecoder()
		const allocStr = (s: string): number => {
			const b = enc.encode(s)
			const dp = ex.swelte_alloc(b.length || 1)
			mem().set(b, dp)
			const sp = ex.swelte_alloc(8)
			dv().setInt32(sp, dp, true)
			dv().setInt32(sp + 4, b.length, true)
			return sp
		}
		const argv: number[] = []
		let rp = 0
		if (retKind === 'string') {
			rp = ex.swelte_alloc(8)
			dv().setInt32(rp, 0, true)
			dv().setInt32(rp + 4, 0, true)
			argv.push(rp)
		}
		for (const p of params) {
			const v = (args as Record<string, unknown>)[p.name]
			if (p.kind === 'string') argv.push(allocStr(typeof v === 'string' ? v : String(v ?? '')))
			else if (p.kind === 'int') argv.push(Number(v ?? 0) | 0)
			else if (p.kind === 'bool') argv.push(v ? 1 : 0)
			else return fail(`unsupported param ${p.name}: ${p.vtype}`)
		}
		const raw = call(...argv)
		if (retKind === 'string') {
			const rop = dv().getInt32(rp, true)
			const rol = dv().getInt32(rp + 4, true)
			if (rop <= 0 || rol < 0 || rol > 16 * 1024 * 1024)
				return fail(`bad string return (ptr=${rop} len=${rol})`)
			return dec.decode(new Uint8Array(ex.memory.buffer, rop, rol)) as TResult
		}
		if (retKind === 'bool') return Boolean(raw) as TResult
		if (retKind === 'int') return (typeof raw === 'number' ? raw | 0 : 0) as TResult
		if (retKind === 'void') return undefined as TResult
		return fail(`unsupported return kind for ${bare}`)
	} catch (e) {
		if (e instanceof SwelteRpcError) throw e
		const bare2 = fn.includes('.') ? (fn.split('.').pop() as string) : fn
		const fb = libFallbacks.get(bare2)
		if (fb) return Promise.resolve(fb((args ?? {}) as Record<string, unknown>) as TResult)
		throw new SwelteRpcError(
			wasmUrl,
			bare2,
			0,
			{
				error: e instanceof Error ? e.message : String(e),
				fn: bare2,
				path: wasmUrl,
				available: [],
			},
			''
		)
	}
}

// Pre-SSR `+error` contract (spec ssr.md §1b): page shells are public,
// page data is guarded. A `load()`-time 4xx/5xx renders the global
// `+error.svelte` ({ status, message }) client-side today; SSR renders
// the same component server-side later. Action-time failures (button
// POSTs) stay inline — only page-data loads route here.
export interface SweltePageError {
	status: number
	message: string
}

export type SwelteLoadResult<T> =
	| { data: T; error?: undefined }
	| { data?: undefined; error: SweltePageError }

/**
 * Page-data loader: runs a `.v` stub, maps any `SwelteRpcError` (or
 * unexpected throw) to `{ error: { status, message } }` for the global
 * `+error` view. Non-`SwelteRpcError` throws surface as status 500.
 * Use for `load()`-time fetches only — form/action errors stay inline.
 */
export async function loadPage<T>(fn: () => Promise<T>): Promise<SwelteLoadResult<T>> {
	try {
		return { data: await fn() }
	} catch (e) {
		if (e instanceof SwelteRpcError) return { error: { status: e.status, message: e.message } }
		return { error: { status: 500, message: String(e) } }
	}
}

/** True when a load result is the error branch (narrows `SwelteLoadResult`). */
export function isPageError<T>(r: SwelteLoadResult<T>): r is { error: SweltePageError } {
	return (r as { error?: unknown }).error !== undefined
}

/** True when a load result is the data branch (narrows `SwelteLoadResult`). */
export function isPageData<T>(r: SwelteLoadResult<T>): r is { data: T } {
	return (r as { error?: unknown }).error === undefined
}

// §1.2 depends/invalidate + §1.4 client-router navigation stores.
// Pure-TS client state (no V side, no SSR): tracks the current page,
// navigation status, and per-route load cache tags. `updated` is a stub
// flag (no version check yet — §4 snapshot export will feed it).

export interface SweltePageState {
	url: string
	params: Record<string, string>
	route: string | null
	data?: unknown
	error?: SweltePageError
	form?: unknown
}

export interface SwelteNavigatingState {
	from: string | null
	to: string | null
}

export type SwelteBeforeNavigate = (nav: {
	from: SweltePageState | null
	to: string
	cancel: () => void
}) => void | Promise<void>
export type SwelteAfterNavigate = (nav: {
	from: string | null
	to: SweltePageState
}) => void | Promise<void>

export interface SwelteStore<T> {
	subscribe: (fn: (v: T) => void) => () => void
	set: (v: T) => void
	get: () => T
}

type Listener<T> = (v: T) => void

function swelteStore<T>(initial: T): {
	subscribe: (fn: Listener<T>) => () => void
	set: (v: T) => void
	get: () => T
} {
	let cur = initial
	const subs = new Set<Listener<T>>()
	return {
		subscribe: (fn) => {
			subs.add(fn)
			fn(cur)
			return () => {
				subs.delete(fn)
			}
		},
		set: (v) => {
			cur = v
			for (const fn of [...subs]) fn(cur)
		},
		get: () => cur,
	}
}

export const page: SwelteStore<SweltePageState> = swelteStore<SweltePageState>({
	url: typeof location !== 'undefined' ? location.pathname : '/',
	params: {},
	route: null,
})

export const navigating: SwelteStore<SwelteNavigatingState | null> =
	swelteStore<SwelteNavigatingState | null>(null)

export const updated: SwelteStore<boolean> = swelteStore<boolean>(false)

const beforeNav: SwelteBeforeNavigate[] = []
const afterNav: SwelteAfterNavigate[] = []

export function beforeNavigate(fn: SwelteBeforeNavigate): () => void {
	beforeNav.push(fn)
	return () => {
		const i = beforeNav.indexOf(fn)
		if (i >= 0) beforeNav.splice(i, 1)
	}
}

export function afterNavigate(fn: SwelteAfterNavigate): () => void {
	afterNav.push(fn)
	return () => {
		const i = afterNav.indexOf(fn)
		if (i >= 0) afterNav.splice(i, 1)
	}
}

export function onNavigate(fn: SwelteAfterNavigate): () => void {
	return afterNavigate(fn)
}

// section 1.4 navigation: thin async wrappers delegating to the
// generated routes.js router at call time (no import cycle: sdk never
// imports generated code; entry-main wires the bridge). Outside the
// browser (SSR/Node) they reject with a clear error.
function __routerFn(name: string): ((...a: unknown[]) => Promise<unknown>) | null {
	try {
		const g = globalThis as unknown as Record<string, Record<string, unknown>>
		const mod = (g.__swelteRoutes ?? g.__swelteRouter) as unknown as
			| Record<string, unknown>
			| undefined
		const fn = mod?.[name]
		return typeof fn === 'function' ? (fn as (...a: unknown[]) => Promise<unknown>) : null
	} catch {
		return null
	}
}
export async function goto(
	url: string | URL,
	opts: { replaceState?: boolean; noPreload?: boolean } = {}
): Promise<void> {
	const fn = __routerFn('goto')
	if (!fn) throw new Error('swelte: goto() needs the client router (browser + entry-main boot)')
	await fn(url, opts)
}
export async function preloadData(url: string | URL): Promise<{
	route: string
	params: Record<string, string>
	data: unknown
	status: number
} | null> {
	const fn = __routerFn('preloadData')
	if (!fn)
		throw new Error('swelte: preloadData() needs the client router (browser + entry-main boot)')
	return (await fn(url)) as {
		route: string
		params: Record<string, string>
		data: unknown
		status: number
	} | null
}
export async function pushState(
	url: string | URL,
	state: Record<string, unknown> = {}
): Promise<void> {
	const fn = __routerFn('pushState')
	if (!fn)
		throw new Error('swelte: pushState() needs the client router (browser + entry-main boot)')
	await fn(url, state)
}

// §1.2 load cache: route-key → tags. `depends()` registers the current
// load's tags during execution; `invalidate(tag)` re-runs loads that
// declared the tag; `invalidateAll()` clears everything.
const loadTags = new Map<string, Set<string>>()
let activeCollect: Set<string> | null = null

export function depends(...tags: string[]): void {
	if (activeCollect) for (const t of tags) activeCollect.add(t)
}

export function invalidate(...tags: string[]): string[] {
	const hit: string[] = []
	for (const [key, set] of loadTags) {
		if (tags.some((t) => set.has(t))) hit.push(key)
	}
	for (const k of hit) loadTags.delete(k)
	return hit
}

export function invalidateAll(): void {
	loadTags.clear()
}

export function __swelteTrackLoad(key: string, fn: () => unknown): unknown {
	const prev = activeCollect
	const tags = new Set<string>()
	activeCollect = tags
	try {
		return fn()
	} finally {
		activeCollect = prev
		loadTags.set(key, tags)
	}
}

// Router bridge: generated routes.js reads these lazily via
// `globalThis.__swelteRouterSdk` (routes.js never imports the SDK bundle
// directly — entry-main wires it once at boot).
export const __beforeNav = beforeNav
export const __afterNav = afterNav

if (typeof globalThis !== 'undefined') {
	const g = globalThis as Record<string, unknown>
	if (!g.__swelteRouterSdk) {
		g.__swelteRouterSdk = {
			page,
			navigating,
			updated,
			__beforeNav: beforeNav,
			__afterNav: afterNav,
		}
	}
}

// §2.11 `fail`-lite: form/action failure convention. V side throws `!T`
// with a `{ ok: false, fieldErrors: {...} }` JSON body (status 422 by
// convention; any 4xx works). Client side narrows it without parsing:
//
//   try { await save_name({ name }) }
//   catch (e) { if (isFail(e)) showInline(e.body.fieldErrors) }
//
// No `actions{}` namespace — verbs + `?q` qualifiers already route;
// this is only the typed-failure shape on top.
export interface SwelteFailBody {
	ok: false
	fieldErrors: Record<string, string>
	[key: string]: unknown
}

/** True when `e` is a `SwelteRpcError` carrying a fail-lite body. When
 * `status` is given it must also match (default: any 4xx). */
export function isFail(
	e: unknown,
	status?: number
): e is SwelteRpcError & { body: SwelteFailBody } {
	if (!(e instanceof SwelteRpcError)) return false
	const b = e.body as unknown as Record<string, unknown> | null
	if (b === null || typeof b !== 'object') return false
	if ((b as { ok?: unknown }).ok !== false) return false
	const fe = (b as { fieldErrors?: unknown }).fieldErrors
	if (fe === null || typeof fe !== 'object' || Array.isArray(fe)) return false
	if (status !== undefined) return e.status === status
	return e.status >= 400 && e.status < 500
}

// §2.12 `#app/forms`-lite: `deserialize` only. Pure TS port of SvelteKit's
// `deserialize` — parses the action-result envelope from a `fetch` response
// (`{"type":"success"|"failure"|"error"|"redirect","data"|"error"|"location","status"}`).
// No client router needed: `use:enhance` calls this on the fetch response.
export type SwelteActionResult =
	| { type: 'success'; status: number; data?: unknown }
	| { type: 'failure'; status: number; data?: unknown }
	| { type: 'error'; status: number; error: unknown }
	| { type: 'redirect'; status: number; location: string }

/** Parse a SvelteKit-shaped action response. Throws `SwelteRpcError`-style
 * `Error` on non-JSON or unknown envelope (same surface as `__swelteFetch`). */
export async function deserialize(res: Response): Promise<SwelteActionResult> {
	const text = await res.text()
	let json: Record<string, unknown>
	try {
		json = JSON.parse(text) as Record<string, unknown>
	} catch {
		throw new Error(
			`swelte: deserialize failed — not JSON (HTTP ${res.status}): ${text.slice(0, 120)}`
		)
	}
	const type = json['type']
	if (type === 'success' || type === 'failure') {
		return {
			type,
			status: typeof json['status'] === 'number' ? json['status'] : res.status,
			data: json['data'],
		}
	}
	if (type === 'error') {
		return {
			type,
			status: typeof json['status'] === 'number' ? json['status'] : res.status,
			error: json['error'],
		}
	}
	if (type === 'redirect') {
		const location = json['location']
		if (typeof location !== 'string')
			throw new Error('swelte: deserialize failed — redirect without location')
		return {
			type,
			status: typeof json['status'] === 'number' ? json['status'] : res.status,
			location,
		}
	}
	throw new Error(`swelte: deserialize failed — unknown type ${JSON.stringify(type)}`)
}

// Forms-lite: `use:enhance` / `applyAction` (docs (built) section 1).
// No-JS still works untouched: without JS the browser submits natively and
// `Hand` answers `303` + `Location` (or an HTML-escaped error page). With
// JS, `enhance` intercepts the submit, replays it as `fetch` with
// `Accept: application/json` (so `Hand` keeps the JSON branch), and
// `applyAction` folds the result into the client stores. Verbs return raw
// JSON - never the SvelteKit envelope - so the mapping is
// `deserialize`-first with a raw-JSON fallback (`ok` maps to `success`,
// `!ok` maps to `failure`, a followed redirect maps to `redirect`).

async function swelteSafeJson(res: Response): Promise<unknown> {
	const text = await res.text()
	if (text === '') return null
	try {
		return JSON.parse(text) as unknown
	} catch {
		return text
	}
}

/** Map a raw verb `fetch` response onto a `SwelteActionResult`.
 *  `deserialize` wins when the server speaks the SvelteKit envelope;
 *  otherwise raw bodies map by status (`2xx` to `success`, else to
 *  `failure` with the decoded body as `data`, so `isFail` narrows it
 *  inline). Not user API - `enhance` calls this. */
export async function __swelteActionResult(res: Response): Promise<SwelteActionResult> {
	if (
		typeof res.redirected === 'boolean' &&
		res.redirected &&
		typeof res.url === 'string' &&
		res.url !== ''
	) {
		return { type: 'redirect', status: res.status, location: res.url }
	}
	let probe: SwelteActionResult | null = null
	try {
		const clone = typeof res.clone === 'function' ? res.clone() : res
		probe = await deserialize(clone)
	} catch {
		probe = null
	}
	if (probe) return probe
	if (res.ok) return { type: 'success', status: res.status, data: await swelteSafeJson(res) }
	return { type: 'failure', status: res.status, data: await swelteSafeJson(res) }
}

export interface SwelteEnhanceSubmit {
	action: URL
	formData: FormData
	formElement: HTMLFormElement
	submitter: HTMLElement | null
	cancelled: boolean
	cancel: () => void
}

export interface SwelteEnhanceUpdateOptions {
	reset?: boolean
	invalidate?: boolean
}

export type SwelteEnhanceResultHandler = (
	result: SwelteActionResult,
	update: (opts?: SwelteEnhanceUpdateOptions) => Promise<void>
) => void | Promise<void>

export type SwelteEnhanceCallback = (
	input: SwelteEnhanceSubmit
) => void | SwelteEnhanceResultHandler | Promise<void | SwelteEnhanceResultHandler>

async function swelteGotoOrReload(location: string): Promise<void> {
	const fn = __routerFn('goto')
	if (fn) {
		await fn(location)
		return
	}
	if (typeof globalThis.location !== 'undefined') globalThis.location.href = location
}

/** Default result handling for `enhance` - also usable standalone:
 *  `success` invalidates cached loads (default) and publishes the payload
 *  on `page.form`, `failure`/`error` publish on `page.form` too (action
 *  failures stay inline per the `loadPage` contract - never `page.error`),
 *  `redirect` navigates via the client router (`goto`, `location.href`
 *  fallback outside the browser router). */
export async function applyAction(
	result: SwelteActionResult,
	opts: { invalidate?: boolean } = {}
): Promise<void> {
	const doInvalidate = opts.invalidate ?? true
	if (result.type === 'redirect') {
		navigating.set(null)
		await swelteGotoOrReload(result.location)
		return
	}
	if (result.type === 'success') {
		if (doInvalidate) invalidateAll()
		page.set({ ...page.get(), form: result.data ?? null })
		navigating.set(null)
		return
	}
	page.set({ ...page.get(), form: result.type === 'failure' ? (result.data ?? null) : null })
	navigating.set(null)
}

/** Svelte action: `use:enhance` (no-arg) or `use:enhance(cb)` with the
 *  SvelteKit callback shape (`({ action, formData, cancel }) =>
 *  async ({ result, update }) => ...`). The default `update()` is
 *  `applyAction` + form reset. Structural typing only - no `svelte/*`
 *  import, so `sdk.ts` stays dependency-free. */
export function enhance(
	node: HTMLFormElement,
	cb?: SwelteEnhanceCallback
): { update?: (next?: SwelteEnhanceCallback) => void; destroy: () => void } {
	let current = cb
	const onSubmit = (e: Event) => {
		void (async () => {
			const submit = e as SubmitEvent & { submitter?: HTMLElement | null }
			const formData = new FormData(node, submit.submitter ?? undefined)
			const rawAction = node.getAttribute('action') ?? ''
			const base =
				typeof globalThis.location !== 'undefined' ? globalThis.location.href : 'http://localhost/'
			const action = new URL(rawAction === '' ? base : rawAction, base)
			const method = (node.getAttribute('method') ?? 'post').toUpperCase()
			const input: SwelteEnhanceSubmit = {
				action,
				formData,
				formElement: node,
				submitter: submit.submitter ?? null,
				cancelled: false,
				cancel: () => {
					input.cancelled = true
				},
			}
			let onResult: SwelteEnhanceResultHandler | void = undefined
			try {
				if (current) onResult = await current(input)
			} catch {
				return
			}
			if (input.cancelled) return
			e.preventDefault()
			const from = typeof globalThis.location !== 'undefined' ? globalThis.location.pathname : null
			navigating.set({ from, to: action.pathname })
			let res: Response
			try {
				res = await fetch(action.toString(), {
					method,
					body: formData,
					headers: { accept: 'application/json' },
				})
			} catch {
				navigating.set(null)
				return
			}
			const result = await __swelteActionResult(res)
			const update = async (updateOpts: SwelteEnhanceUpdateOptions = {}): Promise<void> => {
				if (updateOpts.reset ?? true) {
					try {
						node.reset()
					} catch {
						/* non-DOM stub */
					}
				}
				await applyAction(result, { invalidate: updateOpts.invalidate })
			}
			if (onResult) {
				await onResult(result, update)
				return
			}
			await update()
		})()
	}
	node.addEventListener('submit', onSubmit)
	return {
		update: (next?: SwelteEnhanceCallback) => {
			current = next
		},
		destroy: () => {
			node.removeEventListener('submit', onSubmit)
		},
	}
}

/** True when a `#lib` rel path is backend-only: a `backend` path segment
 * at any depth, or a V-native `_backend.v` suffix. Kept name
 * `isLibServerPath` (public API) — semantics are backend-only.
 * (Body duplicated from `gen/paths.ts`: sdk.ts must stay browser-safe,
 * no node imports; keep both in sync.) */
export function isBackendMod(mod: string): boolean {
	const norm = mod.split('\\').join('/').replace(/\.v$/, '')
	const parts = norm.split('/').filter(Boolean)
	if (parts.includes('backend')) return true
	const stem = parts.pop() ?? ''
	return stem.endsWith('_backend')
}

export function isLibServerPath(libRel: string): boolean {
	return isBackendMod(libRel)
}
