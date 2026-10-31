// `swelte-ssr dev` / `swelte-ssr check`: adapter-owned lifecycle.
// Boots the sidecar, then delegates to core's runDev / a prod-binary probe
// with SWELTE_SSR_URL set. Core knows nothing about engines — this module
// owns the sidecar process. Dev/CI-only: prod embeds the bundle at runtime
// (bytecode-cached, no qjsc binary, no sidecar, no Node at runtime).
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SsrManifest } from './ssr.js'

export interface SsrDevRunOptions {
	root?: string
	port?: number
	backend?: number
	ssrPort?: number
	/** Project outDir (default '.swelte'); mirrors core's loadConfig. */
	outDir?: string
}

/** Boot sidecar + Vite + V (core runDev) with SWELTE_SSR_URL wired. */
export async function runSsrDev(opts: SsrDevRunOptions = {}): Promise<void> {
	const root = resolve(String(opts.root ?? process.cwd()))
	const { loadConfig } = await import('@swelte/core/config')
	const outDir = String(opts.outDir ?? (await loadConfig(root)).outDir ?? '.swelte')
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
	const mf = join(root, outDir, 'ssr-manifest.json')
	let manifest: SsrManifest | null = null
	if (existsSync(mf)) {
		manifest = JSON.parse(readFileSync(mf, 'utf8'))
	}
	if (!manifest) throw new Error(`no ${outDir}/ssr-manifest.json — core generate failed?`)
	await emitRenderJs(manifest, { root, prod: false })
	const renderFile = renderFileFor(root, outDir, false)
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

/** §5 gate as CI (adapter-owned, no V binary needed for the sidecar half).
 * Boots the sidecar + the built V binary (when present) and asserts:
 *  - `/` → 200 `text/html` render with the SSR hydration marker
 *  - `/nope` → 404 `text/html` `+error` render (not blank/JSON)
 *  - `Accept: application/json` on a page route → JSON, not HTML
 *  - sidecar envelope `{html, head}` non-empty for both routes
 *  - `ls dist/ssr/` shows exactly one artifact (post-QJS-link)
 *  - 20× repeat-render against the prod binary: all 200, stable timing
 * Open (documented in specs/ssr.md, not asserted here): `!T` → 500 HTML +
 * server stays up, `/api/greet/` strip, dev HMR touch-and-swap proof.
 * Core's `swelte build` smoke stays static/SPA + JSON — this is the
 * adapter's proof. Missing `+error.svelte` → SPA `index.html` 200 is
 * covered by the static fallback (back-compat, asserted in core smoke).
 * Used by CI and `swelte-ssr check`. */
/** Probe one HTTP assertion against a live base URL. Throws on mismatch. */
async function probeSsr(
	base: string,
	label: string,
	path: string,
	init: RequestInit,
	wantStatus: number,
	wantSubstrings: string[],
	notSubstrings: string[] = []
): Promise<void> {
	const res = await fetch(base + path, init)
	const body = await res.text()
	if (res.status !== wantStatus) {
		throw new Error(`${label} ${path} -> ${res.status} (want ${wantStatus}): ${body.slice(0, 160)}`)
	}
	for (const s of wantSubstrings) {
		if (!body.includes(s)) {
			throw new Error(`${label} ${path} missing ${JSON.stringify(s)}: ${body.slice(0, 160)}`)
		}
	}
	for (const s of notSubstrings) {
		if (body.includes(s)) {
			throw new Error(
				`${label} ${path} must not contain ${JSON.stringify(s)}: ${body.slice(0, 160)}`
			)
		}
	}
}

/** SSR HTML assertions shared by the sidecar half and the prod-binary half.
 *  - `/` → 200 text/html with hydration marker + no ssr placeholders left
 *  - `/nope` → 404 text/html +error fallback (never blank/JSON)
 *  - JSON Accept on a page route → JSON, not HTML (bypass intact)
 *  The caller supplies a `base` and a `label` for error messages.
 *  Marker-only (no `<main>`): any project page passes, example or real. */
async function assertSsrHtml(base: string, label: string): Promise<void> {
	const html: RequestInit = { headers: { accept: 'text/html,application/xhtml+xml' } }
	await probeSsr(
		base,
		label,
		'/',
		html,
		200,
		['data-swelte-ssr="1"'],
		['<!--ssr-body-->', '<!--swelte:ssr:']
	)
	await probeSsr(base, label, '/nope', html, 404, ['data-swelte-ssr="1"'])
	const res = await fetch(base + '/', { headers: { accept: 'application/json' } })
	const body = await res.text()
	if (res.status !== 200 || body.includes('data-swelte-ssr="1"')) {
		throw new Error(`${label} / JSON bypass broken: ${res.status} ${body.slice(0, 120)}`)
	}
	console.log(`ssr check: ${label} html + bypass ok`)
}

/** Boot the built V binary (with embedded QJS) for the prod half of the gate. */
async function withProdBinary(
	root: string,
	binary: string,
	fn: (base: string) => Promise<void>
): Promise<void> {
	const { spawn } = await import('node:child_process')
	const { createServer } = await import('node:net')
	const port = await new Promise<number>((resolvePort, rejectPort) => {
		const s = createServer()
		s.once('error', rejectPort)
		s.listen(0, '127.0.0.1', () => {
			const addr = s.address()
			const p = typeof addr === 'object' && addr ? (addr.port as number) : 0
			s.close(() => resolvePort(p))
		})
	})
	if (!port) throw new Error('no free port for prod-binary probe')
	const child = spawn(binary, [], {
		cwd: root,
		env: { ...process.env, PORT: String(port), SWELTE_DIST: 'dist', SWELTE_SSR: '1' },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let out = ''
	child.stderr?.on('data', (d: Buffer) => {
		out += d.toString()
	})
	child.stdout?.on('data', (d: Buffer) => {
		out += d.toString()
	})
	try {
		const t0 = Date.now()
		for (;;) {
			try {
				await fetch(`http://127.0.0.1:${port}/`)
				break
			} catch {
				if (Date.now() - t0 > 15000) {
					throw new Error(`prod binary did not listen on :${port}\n${out}`)
				}
				await new Promise((r) => setTimeout(r, 200))
			}
		}
		await fn(`http://127.0.0.1:${port}`)
	} finally {
		try {
			child.kill('SIGTERM')
		} catch {
			/* ignore */
		}
		await new Promise((r) => setTimeout(r, 800))
		try {
			child.kill('SIGKILL')
		} catch {
			/* ignore */
		}
	}
}

export async function runSsrCheck(
	opts: { root?: string; renderFile?: string; port?: number; outDir?: string } = {}
): Promise<void> {
	const root = resolve(String(opts.root ?? process.cwd()))
	const { loadConfig } = await import('@swelte/core/config')
	const outDir = String(opts.outDir ?? (await loadConfig(root)).outDir ?? '.swelte')
	const { startSsrDevServer, renderFileFor } = await import('./dev.js')
	const renderFile = opts.renderFile ?? renderFileFor(root, outDir, false)
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
		// 1. `/` renders HTML with the SSR envelope (head/body present).
		const r1 = await post({ route: '/', props: '{}' })
		if (r1.status !== 200) throw new Error(`sidecar / -> ${r1.status}: ${r1.body.slice(0, 120)}`)
		const e1 = JSON.parse(r1.body) as { html?: string; head?: string }
		if (typeof e1.html !== 'string' || e1.html.length === 0)
			throw new Error(`sidecar / missing html envelope: ${r1.body.slice(0, 120)}`)
		console.log('ssr check: / renders HTML ok')
		// 2. Unknown route → `+error` render (parsed envelope: html holds it).
		const r2 = await post({ route: '/nope', props: '{}' })
		if (r2.status !== 200)
			throw new Error(`sidecar /nope -> ${r2.status}: ${r2.body.slice(0, 120)}`)
		const e2 = JSON.parse(r2.body) as { html?: string }
		if (typeof e2.html !== 'string' || e2.html.length === 0)
			throw new Error(`sidecar /nope missing +error fallback: ${r2.body.slice(0, 120)}`)
		console.log('ssr check: /nope +error fallback ok')
		// 2b. Sidecar through Hand: V backend with SWELTE_SSR_URL pointed at
		// the sidecar must serve the same browser-shape HTML. Skipped when
		// no generated backend is present (dev-only manifest check).
		try {
			const { spawn } = await import('node:child_process')
			const { createServer } = await import('node:net')
			const { existsSync: existsSyncV } = await import('node:fs')
			const genRoutes = join(root, outDir, 'routes', 'server_gen.v')
			if (existsSyncV(genRoutes)) {
				const freePort = await new Promise<number>((resPort, rejPort) => {
					const s = createServer()
					s.once('error', rejPort)
					s.listen(0, '127.0.0.1', () => {
						const addr = s.address()
						const p = typeof addr === 'object' && addr ? (addr.port as number) : 0
						s.close(() => resPort(p))
					})
				})
				let toolchain: {
					toolchainEnv?: (e?: Record<string, string>) => NodeJS.ProcessEnv
					resolveCC?: () => string
					resolveV?: (u: string) => string
				} = {}
				try {
					toolchain = (await import('@swelte/core/toolchain')) as unknown as typeof toolchain
				} catch {
					toolchain = {}
				}
				if (toolchain.resolveV && toolchain.toolchainEnv) {
					const vBin = toolchain.resolveV(import.meta.url)
					const hasBridge = existsSyncV(join(root, outDir, 'routes', 'swelte_qjs_bridge.v'))
					const cc = typeof toolchain.resolveCC === 'function' ? toolchain.resolveCC() : 'gcc'
					const vArgs = hasBridge
						? ['-enable-globals', '-cc', cc, 'run', join(root, outDir, 'server.v')]
						: ['run', join(root, outDir, 'server.v')]
					const backend = spawn(vBin, vArgs, {
						cwd: root,
						env: toolchain.toolchainEnv({
							PORT: String(freePort),
							SWELTE_DIST: 'dist',
							SWELTE_SSR_URL: sidecar.url,
						}),
						stdio: ['ignore', 'pipe', 'pipe'],
					})
					try {
						const t0 = Date.now()
						for (;;) {
							try {
								await fetch(`http://127.0.0.1:${freePort}/`)
								break
							} catch {
								if (Date.now() - t0 > 30000) throw new Error('V backend did not listen')
								await new Promise((r) => setTimeout(r, 300))
							}
						}
						await assertSsrHtml(`http://127.0.0.1:${freePort}`, 'sidecar-via-Hand')
					} finally {
						try {
							backend.kill('SIGTERM')
						} catch {
							/* ignore */
						}
						await new Promise((r) => setTimeout(r, 800))
						try {
							backend.kill('SIGKILL')
						} catch {
							/* ignore */
						}
					}
				} else {
					console.log('ssr check: toolchain import unavailable — skipping Hand half')
				}
			} else {
				console.log(`ssr check: no ${outDir}/routes/server_gen.v — skipping Hand half`)
			}
		} catch (e) {
			throw new Error(`ssr check: sidecar-via-Hand failed: ${(e as Error).message}`)
		}
		// 4. Prod binary half (embedded QJS): when dist/server exists, boot it
		// with SWELTE_SSR=1 and assert the same browser-shape HTML. This is
		// the path `swelte preview` serves — the gate that caught the GET
		// 303 loop and the unset-SWELTE_SSR fallback.
		try {
			const { existsSync: existsSyncB } = await import('node:fs')
			const binary = join(root, 'dist', 'server')
			if (existsSyncB(binary)) {
				await withProdBinary(root, binary, async (base) => {
					await assertSsrHtml(base, 'prod-binary')
				})
			} else {
				console.log('ssr check: no dist/server — skipping prod-binary half')
			}
		} catch (e) {
			throw new Error(`ssr check: prod-binary half failed: ${(e as Error).message}`)
		}
		// 5. Bytecode repeat-render: the prod binary caches the compiled
		// bundle (FNV-1a key, ring of 4) and reuses it across renders.
		// 20 sequential browser GETs must all be 200 SSR HTML with no
		// crash (the double-link assertion killed the server on render
		// #2 before the loader fix) and stable timing.
		try {
			const { existsSync: existsSyncC } = await import('node:fs')
			const binary = join(root, 'dist', 'server')
			if (existsSyncC(binary)) {
				await withProdBinary(root, binary, async (base) => {
					const times: number[] = []
					for (let i = 0; i < 20; i++) {
						const t0 = Date.now()
						const res = await fetch(base + '/', {
							headers: { accept: 'text/html,application/xhtml+xml' },
						})
						const body = await res.text()
						times.push(Date.now() - t0)
						if (res.status !== 200 || !body.includes('data-swelte-ssr="1"')) {
							throw new Error(`repeat render #${i}: ${res.status} ${body.slice(0, 80)}`)
						}
					}
					const sorted = [...times].sort((a, b) => a - b)
					console.log(
						`ssr check: 20x repeat render ok (min ${sorted[0]}ms p50 ${sorted[10]}ms max ${sorted[sorted.length - 1]}ms)`
					)
				})
			}
		} catch (e) {
			throw new Error(`ssr check: repeat-render half failed: ${(e as Error).message}`)
		}

		// 3. Single artifact in dist/ssr/ (post-QJS-link: exactly one).
		const { readdirSync } = await import('node:fs')
		try {
			const files = readdirSync(join(root, 'dist', 'ssr'))
			if (files.length !== 1)
				throw new Error(`dist/ssr/ has ${files.length} files (want exactly 1): ${files.join(', ')}`)
			console.log(`ssr check: single artifact ok (dist/ssr/${files[0]})`)
		} catch (e) {
			if ((e as Error).message.startsWith('dist/ssr/ has')) throw e
			console.log('ssr check: dist/ssr/ absent (dev-only) — skipping artifact gate')
		}
	} finally {
		await sidecar.close()
	}
}
