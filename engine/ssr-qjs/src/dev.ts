// Dev SSR sidecar (adapter-owned, never core).
// Serves the compiled `render.js` IIFE over HTTP so `Hand` (V, no JS
// engine) can render without linking QuickJS. Same protocol the future
// `ssr-bun` sidecar uses: POST / { route, props } -> { html, head }.
// The bundle is engine-agnostic IIFE — dev verifies HTML + hydration,
// not the QJS engine (bytecode/embed/caps are prod-only).
// HMR: watches the render.js file (mtime); re-imports on change, no
// V restart. Timeout on any render -> caller falls back to SPA shell.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, statSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface SsrDevOptions {
	root: string
	renderFile: string
	port: number
}

export async function startSsrDevServer(opts: SsrDevOptions) {
	const { root, renderFile } = opts
	let mod: {
		renderRoute: (route: string, props_json: string) => { head: string; body: string }
	} | null = null
	let mtime = 0

	async function load() {
		try {
			const st = statSync(renderFile)
			if (st.mtimeMs <= mtime && mod) return
			mtime = st.mtimeMs
			const url = pathToFileURL(renderFile).href + `?t=${mtime}`
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
		})
	} catch {
		/* best-effort */
	}

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		if (req.method !== 'POST' || req.url !== '/') {
			res.writeHead(404, { 'content-type': 'application/json' })
			res.end('{"error":"not found"}')
			return
		}
		let raw = ''
		for await (const chunk of req) raw += chunk
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
			const out = mod.renderRoute(route, props)
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

export function renderFileFor(root: string, outDir: string): string {
	const prod = join(resolve(root), 'dist', 'ssr', 'render.js')
	if (existsSync(prod)) return prod
	return join(resolve(root), outDir, 'dev', 'render.js')
}
