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

async function postJson<TResult>(base: string, fn: string, args: object): Promise<TResult> {
	const res = await fetch(base, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({ fn, args: args ?? {} }),
	})
	if (!res.ok) return throwForStatus(base, fn, res)
	return res.json()
}

async function getVerb<TResult>(
	base: string,
	fn: string,
	method: string,
	qualifier: string,
	args: object
): Promise<TResult> {
	const q = qualifier ? `?q=${encodeURIComponent(qualifier)}` : ''
	const res = await fetch(`${base}${q}${encodeQuery(args ?? {}).replace(/^\?/, q ? '&' : '?')}`, {
		method,
		headers: { accept: 'application/json' },
	})
	if (!res.ok) return throwForStatus(base, fn, res)
	return res.json()
}

async function postForm<TResult>(
	base: string,
	fn: string,
	method: string,
	qualifier: string,
	args: object
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
	return res.json()
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
	qualifier = ''
): Promise<TResult> {
	if (kind === 'rpc') return postJson<TResult>(base, fn, args)
	if (kind === 'get' || kind === 'put' || kind === 'delete' || kind === 'patch') {
		return getVerb<TResult>(base, fn, kind.toUpperCase(), qualifier, args)
	}
	return postForm<TResult>(base, fn, 'POST', qualifier, args)
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
			{ error: e instanceof Error ? e.message : String(e), fn: bare2, path: wasmUrl, available: [] },
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
