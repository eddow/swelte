// Dev SSR sidecar (adapter-owned, never core).
// Serves the compiled `render.js` IIFE over HTTP so `Hand` (V, no JS
// engine) can render without linking QuickJS: POST / { route, props } -> { html, head }.
// The bundle is engine-agnostic IIFE — dev verifies HTML + hydration,
// not the QJS engine (bytecode/embed/caps are prod-only).
// HMR: watches the render.js file (mtime); re-imports on change, no
// V restart. Timeout on any render -> caller falls back to SPA shell.

import { existsSync, statSync, watch } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface SsrDevOptions {
	root: string
	renderFile: string
	port: number
	/** Per-render budget in ms (default 50, 0 = none). Races the bundle call. */
	renderTimeoutMs?: number
	/** Max JSON body in bytes (default 1MB). Larger → 413, never buffered. */
	maxBodyBytes?: number
}

export async function startSsrDevServer(opts: SsrDevOptions) {
	const { root } = opts
	const renderFile = opts.renderFile
	let mod: {
		renderRoute: (route: string, props_json: string) => { head: string; body: string }
	} | null = null
	let mtime = 0
	// Budget per render (dev-only parity with prod's ~50ms guard): slow
	// renders race a timer; the loser is ignored and the caller gets 500
	// → SPA fallback, so a stuck bundle can't hang Hand.

	async function load() {
		try {
			const st = statSync(renderFile)
			if (st.mtimeMs <= mtime && mod) return
			mtime = st.mtimeMs
			const url = `${pathToFileURL(renderFile).href}?t=${mtime}`
			mod = (await import(url)) as typeof mod
		} catch {
			mod = null
		}
	}

	try {
		watch(resolve(root), { recursive: true }, (_ev, file) => {
			if (typeof file === 'string' && file.endsWith('.svelte')) {
				mtime = 0
			}
		}).unref?.()
	} catch {
		/* best-effort */
	}

	const renderTimeoutMs = opts.renderTimeoutMs ?? 50
	const maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		if (req.method !== 'POST' || req.url !== '/') {
			res.writeHead(404, { 'content-type': 'application/json' })
			res.end('{"error":"not found"}')
			return
		}
		let raw = ''
		let tooBig = false
		for await (const chunk of req) {
			raw += chunk
			if (raw.length > maxBodyBytes) {
				tooBig = true
				break
			}
		}
		if (tooBig) {
			res.writeHead(413, { 'content-type': 'application/json' })
			res.end('{"error":"body too large"}')
			try {
				req.socket.destroy()
			} catch {
				/* ignore */
			}
			return
		}
		let route = ''
		let props = '{}'
		try {
			const parsed = JSON.parse(raw)
			route = String(parsed.route ?? '')
			props = typeof parsed.props === 'string' ? parsed.props : JSON.stringify(parsed.props ?? {})
		} catch {
			res.writeHead(400, { 'content-type': 'application/json' })
			res.end('{"error":"bad json"}')
			return
		}
		await load()
		if (!mod) {
			res.writeHead(503, { 'content-type': 'application/json' })
			res.end('{"error":"no renderer (render.js missing — run vite build or swelte dev)"}')
			return
		}
		try {
			const renderP = Promise.resolve().then(() => mod!.renderRoute(route, props))
			const out =
				renderTimeoutMs > 0
					? await Promise.race([
							renderP,
							new Promise<never>((_, rej) =>
								setTimeout(() => rej(new Error('render timeout')), renderTimeoutMs)
							),
						])
					: await renderP
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ html: out.body, head: out.head ?? '' }))
		} catch (e) {
			res.writeHead(500, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ error: String(e) }))
		}
	})

	await new Promise<void>((resolveReady, rejectReady) => {
		server.once('error', rejectReady)
		server.listen(opts.port, '127.0.0.1', () => {
			server.off('error', rejectReady)
			resolveReady()
		})
	})
	return {
		port: opts.port,
		url: `http://127.0.0.1:${opts.port}`,
		async close() {
			await new Promise<void>((r) => server.close(() => r()))
		},
	}
}

export function defaultSsrDevPort(): number {
	return 8132
}

export function renderFileFor(root: string, outDir: string, preferProd = true): string {
	const dev = join(resolve(root), outDir, 'dev', 'render.js')
	// Dev sidecars must read the dev bundle (HMR); prod (embedded QJS,
	// SWELTE_SSR=1) reads dist/ssr/render.js itself. Preferring prod here
	// would silently pin dev to a stale build after one `swelte build`.
	if (!preferProd && existsSync(dev)) return dev
	const prod = join(resolve(root), 'dist', 'ssr', 'render.js')
	if (preferProd && existsSync(prod)) return prod
	return dev
}
