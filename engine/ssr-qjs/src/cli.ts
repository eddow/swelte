// `swelte-ssr dev` / `swelte-ssr check`: adapter-owned lifecycle.
// Boots the sidecar, then delegates to core's runDev / a prod-binary probe
// with SWELTE_SSR_URL set. Core knows nothing about engines — this module
// owns the sidecar process. Dev/CI-only: prod embeds the bundle via qjsc,
// no sidecar, no Node at runtime.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SsrManifest } from './ssr.js'

export interface SsrDevRunOptions {
	root?: string
	port?: number
	backend?: number
	ssrPort?: number
}

/** Boot sidecar + Vite + V (core runDev) with SWELTE_SSR_URL wired. */
export async function runSsrDev(opts: SsrDevRunOptions = {}): Promise<void> {
	const root = resolve(String(opts.root ?? process.cwd()))
	const { startSsrDevServer, renderFileFor } = await import('./dev.js')
	const { emitRenderJs } = await import('./ssr.js')
	const { readFileSync } = await import('node:fs')
	// Core generate first (manifest must exist).
	const { swelte } = (await import('@swelte/core/vite')) as unknown as {
		swelte: (o: Record<string, unknown>) => {
			buildStart?: () => Promise<void> | void
			configResolved?: (c: { root: string }) => void
		}
	}
	const plug = swelte({})
	plug.configResolved?.({ root })
	await plug.buildStart?.()
	const outDirs = ['.swelte', '.swelte']
	let manifest: SsrManifest | null = null
	for (const od of outDirs) {
		const mf = join(root, od, 'ssr-manifest.json')
		if (existsSync(mf)) {
			manifest = JSON.parse(readFileSync(mf, 'utf8'))
			break
		}
	}
	if (!manifest) throw new Error('no .swelte/ssr-manifest.json — core generate failed?')
	await emitRenderJs(manifest, { root, prod: false })
	const renderFile = renderFileFor(root, '.swelte')
	const ssrPort = opts.ssrPort ?? 8132
	const sidecar = await startSsrDevServer({ root, renderFile, port: ssrPort })
	console.log(`swelte-ssr dev: sidecar ${sidecar.url} (dev-only; prod embeds via qjsc)`)
	process.env.SWELTE_SSR_URL = sidecar.url
	const { runDev } = (await import('@swelte/core/cli')) as unknown as {
		runDev: (ctx: {
			opts: Record<string, unknown>
			rest: string[]
			log: (m: string) => void
			error: (m: string) => void
		}) => Promise<void>
	}
	const stop = () => {
		void sidecar.close().catch(() => {})
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
	try {
		await runDev({
			opts: { root, port: opts.port ?? 5174, backend: opts.backend ?? 8131 },
			rest: [],
			log: (m: string) => console.log(`swelte dev: ${m}`),
			error: (m: string) => console.error(`swelte dev: ${m}`),
		})
	} finally {
		await sidecar.close().catch(() => {})
	}
}

/** SSR proof gate: boots sidecar + asserts markers/404 (no V binary needed).
 * Used by CI and `swelte-ssr check`. Core's `swelte build` smoke stays
 * static/SPA — this is the adapter's proof. */
export async function runSsrCheck(
	opts: { root?: string; renderFile?: string; port?: number } = {}
): Promise<void> {
	const root = resolve(String(opts.root ?? process.cwd()))
	const { startSsrDevServer, renderFileFor } = await import('./dev.js')
	const renderFile = opts.renderFile ?? renderFileFor(root, '.swelte')
	if (!existsSync(renderFile))
		throw new Error(`no renderer at ${renderFile} — run vite build (adapter) first`)
	const sidecar = await startSsrDevServer({ root, renderFile, port: opts.port ?? 8133 })
	try {
		const post = async (payload: unknown): Promise<{ status: number; body: string }> => {
			const res = await fetch(sidecar.url + '/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			})
			return { status: res.status, body: await res.text() }
		}
		const r1 = await post({ route: '/', props: '{}' })
		if (r1.status !== 200) throw new Error(`sidecar / -> ${r1.status}: ${r1.body.slice(0, 120)}`)
		if (!r1.body.includes('<main>'))
			throw new Error(`sidecar / missing <main> render: ${r1.body.slice(0, 120)}`)
		console.log('ssr check: / renders HTML ok')
	} finally {
		await sidecar.close()
	}
}
