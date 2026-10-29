// Swelte client runtime. No back-compat: the only user API is importing
// `.v` files (codegen calls __swelteFetch / __swelteWasmCall).
// Direct sdk.post/get/worker usage was removed with self/$ssapi/$csapi.

export type Args = Record<string, unknown>

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

async function getVerb<TResult>(base: string, fn: string, method: string, qualifier: string, args: object): Promise<TResult> {
	const q = qualifier ? `?q=${encodeURIComponent(qualifier)}` : ''
	const res = await fetch(
		`${base}${encodeQuery(args ?? {}).replace(/^\?/, q ? '&' : '?') || q}`,
		{
			method,
			headers: { accept: 'application/json' },
		}
	)
	if (!res.ok) return throwForStatus(base, fn, res)
	return res.json()
}

async function postForm<TResult>(base: string, fn: string, method: string, qualifier: string, args: object): Promise<TResult> {
	const q = qualifier ? `?q=${encodeURIComponent(qualifier)}` : ''
	const params = new URLSearchParams()
	for (const [k, v] of Object.entries((args ?? {}) as Record<string, unknown>)) {
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

// Dev fallback registry for `#lib/*.v` before `v -b wasm` artifacts exist.
// Keyed by bare fn name (the stub passes a per-build wasmUrl that cannot
// be known here). Production WASM modules bypass the registry entirely.
type LibHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>
const libFallbacks = new Map<string, LibHandler>()

export function __registerLibFallback(fn: string, handler: LibHandler): void {
	libFallbacks.set(fn, handler)
}

function strArg(args: Record<string, unknown>, key: string): string {
	const v = args[key]
	return typeof v === 'string' ? v : String(v ?? '')
}

// Built-in dev fallbacks (mirror src/lib/**/*.v until `v -b wasm` lands).
__registerLibFallback('hash_string', (args) => `hash(${strArg(args, 'input')})`)

const wasmInstances = new Map<string, Promise<Record<string, (argsJson: string) => unknown>>>()

/**
 * Internal WASM caller for code-generated `#lib/*.v` stubs
 * (spec v-imports.md §4). JSON across the boundary; `!T` failure
 * rejects with SwelteRpcError(status 0). Falls back to the dev registry
 * when no artifact is present (migration step 3 compiles real WASM).
 */
export async function __swelteWasmCall<TResult>(
	wasmUrl: string,
	fn: string,
	args: object = {}
): Promise<TResult> {
	const fallback = libFallbacks.get(fn)
	if (fallback) {
		return Promise.resolve(fallback((args ?? {}) as Record<string, unknown>) as TResult)
	}
	if (wasmUrl.includes('.swelte/generated') || wasmUrl.endsWith('.wasm?url')) {
		throw new SwelteRpcError(
			wasmUrl,
			fn,
			0,
			{
				error: `WASM not compiled yet for ${fn} (migration step 3 wires v -b wasm)`,
				fn,
				path: wasmUrl,
				available: [...libFallbacks.keys()],
			},
			''
		)
	}
	let inst = wasmInstances.get(wasmUrl)
	if (!inst) {
		inst = (async () => {
			const mod = (await import(/* @vite-ignore */ wasmUrl)) as {
				default?: (opts?: unknown) => Promise<unknown>
				[k: string]: unknown
			}
			if (typeof mod.default === 'function') await mod.default()
			const fns: Record<string, (argsJson: string) => unknown> = {}
			for (const [k, v] of Object.entries(mod)) {
				if (k !== 'default' && typeof v === 'function') fns[k] = v as (argsJson: string) => unknown
			}
			return fns
		})()
		wasmInstances.set(wasmUrl, inst)
	}
	try {
		const fns = await inst
		const target = fns[fn]
		if (!target) {
			const available = Object.keys(fns)
			throw new SwelteRpcError(
				wasmUrl,
				fn,
				0,
				{ error: 'unknown fn', fn, path: wasmUrl, available },
				''
			)
		}
		const raw = target(JSON.stringify(args ?? {}))
		const out = raw instanceof Promise ? await raw : raw
		if (typeof out === 'string') {
			try {
				return JSON.parse(out) as TResult
			} catch {
				return out as TResult
			}
		}
		return out as TResult
	} catch (e) {
		if (e instanceof SwelteRpcError) throw e
		throw new SwelteRpcError(
			wasmUrl,
			fn,
			0,
			{ error: e instanceof Error ? e.message : String(e), fn, path: wasmUrl },
			''
		)
	}
}

/** True when a `#lib` rel path is server-only (a `server` path segment). */
export function isLibServerPath(libRel: string): boolean {
	const parts = libRel.split('/').filter(Boolean)
	return parts.includes('server')
}
