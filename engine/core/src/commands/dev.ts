// `swelte dev`: compile the V backend, own its executable directly,
// and manage Vite through its Node API. Stop only resources we created.
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { join, resolve } from 'node:path'
import { DevBackend } from './dev-backend.js'
import { launchDevApplication } from './dev-control.js'
import { type DevVite, startDevVite } from './dev-vite.js'
import { childExit } from './process.js'
import type { Ctx } from './types.js'

export function takePort(v: unknown, fallback: number): number {
	const n = typeof v === 'number' ? v : Number(v)
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function portFree(port: number): Promise<boolean> {
	return new Promise((resolveFree) => {
		const s: Server = createServer()
		s.once('error', () => resolveFree(false))
		s.once('listening', () => s.close(() => resolveFree(true)))
		s.listen(port, '127.0.0.1')
	})
}

/** Occupied ports belong to someone else; never terminate their owners. */
export async function requireFreePort(port: number): Promise<void> {
	if (!(await portFree(port))) {
		throw new Error(`port ${port} is already in use — stop its owner or choose another port`)
	}
}

/** Recursive `.v` watch that works on Linux: `fs.watch(recursive:true)`
 * only recurses on macOS/Windows. Walk subdirs and watch each one. */
export function watchVRecursive(
	dir: string,
	onVFile: (file: string) => void
): { close: () => void } {
	type W = ReturnType<typeof watch>
	const watchers: W[] = []
	let closed = false
	try {
		const walk = (d: string) => {
			if (closed) return
			try {
				if (!statSync(d).isDirectory()) return
			} catch {
				return
			}
			try {
				const w = watch(d, (_ev, file) => {
					if (closed) return
					// A new subdir appeared — watch it too.
					if (file) {
						const cand = join(d, String(file))
						try {
							if (statSync(cand).isDirectory() && !String(file).endsWith('.v')) {
								walk(cand)
								return
							}
						} catch {
							/* not a dir */
						}
						if (String(file).endsWith('.v')) onVFile(String(file))
					}
				})
				watchers.push(w)
			} catch {
				/* ignore */
			}
			let entries: string[] = []
			try {
				entries = readdirSync(d)
			} catch {
				return
			}
			for (const e of entries) {
				if (e === 'node_modules' || e === '.swelte' || e.startsWith('.')) continue
				walk(join(d, e))
			}
		}
		walk(dir)
	} catch {
		/* ignore */
	}
	return {
		close: () => {
			closed = true
			for (const w of watchers) {
				try {
					w.close()
				} catch {
					/* ignore */
				}
			}
		},
	}
}

/** Attach a readable `error` handler to a spawned child (missing binary
 * otherwise surfaces as an unhandled 'error' event). */
export function onSpawnError(child: ChildProcess, label: string, log: (m: string) => void): void {
	child.on('error', (e: Error) => {
		log(`${label} failed to start: ${e.message} (is the binary on PATH? see toolchain)`)
	})
}

export interface SsrSidecar {
	url: string
	close: () => Promise<void>
}

/** Probe for an installed SSR adapter without depending on it.
 * Core stays engine-agnostic: when `@swelte/ssr-qjs` is resolvable from
 * the project root, boot its dev sidecar (`.swelte/dev/render.js` over
 * HTTP) and return its URL so the V backend (`SWELTE_SSR_URL`) can proxy
 * renders. When absent/unresolvable (SPA-only project, or adapter not
 * installed), return null — `swelte dev` works unchanged. Never throws. */
export async function maybeStartSsrSidecar(
	root: string,
	opts: { ssrPort?: number; ssr?: boolean } = {},
	log: (m: string) => void = () => {}
): Promise<SsrSidecar | null> {
	if (opts.ssr === false) return null
	if (process.env.SWELTE_SSR_URL) return null
	try {
		const { createRequire } = await import('node:module')
		const { pathToFileURL } = await import('node:url')
		const req = createRequire(pathToFileURL(join(resolve(root), 'package.json')).href)
		let devUrl: string
		try {
			devUrl = req.resolve('@swelte/ssr-qjs/dev')
		} catch {
			return null
		}
		const devMod = (await import(pathToFileURL(devUrl).href)) as {
			startSsrDevServer: (o: {
				root: string
				renderFile: string
				port: number
				watchDirs?: string[]
				renderTimeoutMs?: number
			}) => Promise<{ url: string; close: () => Promise<void> }>
			renderFileFor: (root: string, outDir: string, preferProd?: boolean) => string
			defaultSsrDevPort?: () => number
		}
		const ssrMod = (await import(pathToFileURL(req.resolve('@swelte/ssr-qjs/ssr')).href)) as {
			emitRenderJs: (
				manifest: unknown,
				o: { root: string; prod: boolean; routesDir?: string; libDir?: string }
			) => Promise<string>
		}
		const { loadConfig } = await import('../gen/config.js')
		const config = await loadConfig(root)
		const outDir = String(config.outDir ?? '.swelte')
		const mf = join(root, outDir, 'ssr-manifest.json')
		let manifest: unknown = null
		try {
			manifest = JSON.parse(readFileSync(mf, 'utf8'))
		} catch {
			return null
		}
		if (!manifest) return null
		const renderFile = await ssrMod.emitRenderJs(manifest, {
			root,
			prod: false,
			routesDir: config.routesDir,
			libDir: config.libDir,
		})
		const envPort = Number(process.env.SWELTE_SSR_PORT ?? 0)
		const ssrPort =
			opts.ssrPort ??
			((Number.isFinite(envPort) && envPort > 0 ? envPort : 0) ||
				devMod.defaultSsrDevPort?.() ||
				8132)
		const sidecar = await devMod.startSsrDevServer({
			root,
			renderFile,
			port: ssrPort,
			watchDirs: [config.routesDir, config.libDir],
		})
		// HMR for .svelte edits: Vite rebuilds client bundles, but the
		// sidecar serves `.swelte/dev/render.js` — re-emit it on change
		// (debounced) so the sidecar's mtime check picks it up.
		try {
			let timer: NodeJS.Timeout | null = null
			const reemit = () => {
				if (timer) clearTimeout(timer)
				timer = setTimeout(() => {
					void (async () => {
						try {
							const fresh = JSON.parse(readFileSync(mf, 'utf8'))
							await ssrMod.emitRenderJs(fresh, {
								root,
								prod: false,
								routesDir: config.routesDir,
								libDir: config.libDir,
							})
						} catch {
							/* best-effort HMR */
						}
					})()
				}, 300)
			}
			for (const dir of [config.routesDir, config.libDir]) {
				const abs = join(root, dir)
				if (!existsSync(abs)) continue
				try {
					const w = watch(abs, { recursive: true }, (_ev, file) => {
						if (typeof file === 'string' && file.endsWith('.svelte')) reemit()
					})
					w.unref?.()
					// Track on the sidecar so close() below frees them.
					;(sidecar as unknown as { __watchers?: unknown[] }).__watchers ??= []
					;(sidecar as unknown as { __watchers: unknown[] }).__watchers.push(w)
				} catch {
					/* best-effort */
				}
			}
		} catch {
			/* best-effort */
		}
		log(`SSR sidecar ${sidecar.url} (@swelte/ssr-qjs dev-only; prod embeds via qjsc)`)
		return {
			url: sidecar.url,
			close: async () => {
				try {
					for (const w of (sidecar as unknown as { __watchers?: { close?: () => void }[] })
						.__watchers ?? [])
						try {
							w.close?.()
						} catch {
							/* ignore */
						}
				} catch {
					/* ignore */
				}
				await sidecar.close().catch(() => {})
			},
		}
	} catch (e) {
		log(`SSR sidecar skipped: ${(e as Error).message}`)
		return null
	}
}
export function findViteConfig(root: string): string | null {
	for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
		if (existsSync(join(root, f))) return f
	}
	return null
}

export function hasSweltePlugin(root: string, file: string): boolean {
	try {
		const src = readFileSync(join(root, file), 'utf8')
		return src.includes('swelte(') || src.includes('@swelte/core/vite')
	} catch {
		return false
	}
}

export async function waitPort(port: number, ms: number): Promise<boolean> {
	const t0 = Date.now()
	while (Date.now() - t0 < ms) {
		if (!(await portFree(port))) return true
		await new Promise((r) => setTimeout(r, 200))
	}
	return !(await portFree(port))
}

/** Contract the preview/e2e probe asserts against a booted artifact (test-only helper:
 * page HTML on `/` (browser accept), greet API when the route exists,
 * JSON-accept shape otherwise. Exported for the smoke-matrix tests:
 * pass a stub binary (`node -e` server) to exercise the matrix without
 * a V toolchain. */
export async function probeSmoke(
	port: number,
	hasGreetRoute: boolean,
	log: (m: string) => void = () => {}
): Promise<void> {
	// Portable probe helper (no curl): fetch with a hard timeout.
	const probeGet = async (
		path: string,
		accept: string
	): Promise<{ status: number; body: string }> => {
		const ctrl = new AbortController()
		const t = setTimeout(() => ctrl.abort(), 5000)
		try {
			const res = await fetch(`http://127.0.0.1:${port}${path}`, {
				headers: { accept },
				signal: ctrl.signal,
			})
			return { status: res.status, body: await res.text() }
		} finally {
			clearTimeout(t)
		}
	}
	if (!(await waitPort(port, 15000)))
		throw new Error(`built binary did not listen on :${port} within 15s`)
	const page = await probeGet('/', 'text/html')
	if (page.status !== 200) throw new Error(`smoke page: HTTP ${page.status} (want 200)`)
	// Empty scaffold has no api/greet.v — only probe the API when the
	// route exists; otherwise the page probe + JSON check is the smoke.
	if (hasGreetRoute) {
		const api = await probeGet('/api/greet?payload=%22w%22', 'application/json')
		if (!api.body.includes('Hello')) throw new Error(`smoke api: unexpected body ${api.body}`)
		log(`smoke: page 200 + api ok (:${port})`)
	} else {
		const json = await probeGet('/', 'application/json')
		log(`smoke: page 200 (no api/greet route; json ${json.status}) (:${port})`)
	}
}

export async function runDev(ctx: Ctx): Promise<void> {
	const root = resolve(String(ctx.opts.root ?? process.cwd()))
	const port = takePort(ctx.opts.port, 5174)
	const backend = takePort(ctx.opts.backend, 8131)
	if (port === backend) throw new Error('Vite and backend ports must differ')
	await requireFreePort(port)
	await requireFreePort(backend)
	const {
		resolveV,
		vVersion,
		toolchainEnv,
		resolveHostCC,
		needsGlobals,
		hasRealBridge,
		loadDotenv,
	} = await import('../toolchain.js')
	loadDotenv(root)
	const { loadConfig } = await import('../gen/config.js')
	const v = resolveV(import.meta.url)
	ctx.log(`V toolchain: ${vVersion(v)} (${v})`)
	ctx.log(`root ${root}`)
	const cfg = await loadConfig(root)
	const genAbs = join(root, cfg.outDir)
	const viteConfig = findViteConfig(root)
	if (!viteConfig) throw new Error(`no vite.config.* in ${root} (swelte dev needs one)`)
	if (!hasSweltePlugin(root, viteConfig)) {
		ctx.log(`warning: ${viteConfig} does not reference the swelte() plugin`)
	}
	let compiler: ChildProcess | null = null
	let controller: DevBackend | undefined
	let sessionDir: string | undefined
	let compilerShutdownTimer: NodeJS.Timeout | undefined
	let ui: DevVite | null = null
	let ssrSidecar: SsrSidecar | null = null
	let stopping = false
	let ready = false
	let timer: NodeJS.Timeout | undefined
	const watchHandles: { close: () => void }[] = []
	const shutdownRaw = Number(process.env.SWELTE_SHUTDOWN_TIMEOUT_MS)
	const shutdownMs = Number.isFinite(shutdownRaw) && shutdownRaw > 0 ? shutdownRaw : 10000
	const originalRawMode = process.stdin.isRaw ?? false
	let resolveDone!: () => void
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve
	})
	const stop = () => {
		if (stopping) return
		stopping = true
		clearTimeout(timer)
		ctx.log('shutting down...')
		void controller?.stop().catch((error: Error) => ctx.log(error.message))
		// Compilation normally finishes on its own; only a hung compiler is forced.
		const child = compiler
		if (child)
			compilerShutdownTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					ctx.log('compiler did not finish during shutdown; forcing its exit')
					child.kill('SIGKILL')
				}
			}, shutdownMs + 500)
		resolveDone()
	}
	const buildBackend = async (generation: number): Promise<string> => {
		const binary = join(
			sessionDir!,
			`server-${generation}${process.platform === 'win32' ? '.exe' : ''}`
		)
		await ui!.prepare()
		if (stopping) throw new Error('build cancelled')
		let vArgs: string[] = ['-o', binary, join(genAbs, 'server.v')]
		const withGlobals = needsGlobals(genAbs)
		const hasBridge = hasRealBridge(genAbs)
		if (hasBridge) {
			const cc = resolveHostCC(import.meta.url)
			if (!cc) {
				throw new Error(
					'no C compiler: install gcc/clang or run `npx vvm prepare` (writes the host zig-cc wrapper)'
				)
			}
			vArgs = ['-enable-globals', '-cc', cc, '-o', binary, join(genAbs, 'server.v')]
			ctx.log(`QJS embed: -enable-globals -cc ${vArgs[2]} (bridge present)`)
		} else if (withGlobals) {
			vArgs = ['-enable-globals', '-o', binary, join(genAbs, 'server.v')]
			ctx.log('plugin V modules: -enable-globals (__global in includes)')
		}
		ctx.log('compiling V backend...')
		const build = spawn(v, vArgs, {
			cwd: root,
			env: toolchainEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		compiler = build
		build.stdout?.on('data', (d: Buffer) => process.stdout.write(`[v:build] ${d}`))
		build.stderr?.on('data', (d: Buffer) => process.stderr.write(`[v:build] ${d}`))
		const deadline = setTimeout(() => {
			ctx.log('V compilation exceeded 120s; forcing the compiler to exit')
			build.kill('SIGKILL')
		}, 120000)
		try {
			await childExit(build, 'V compiler')
			return binary
		} catch (error) {
			await rm(binary, { force: true })
			throw error
		} finally {
			clearTimeout(deadline)
			clearTimeout(compilerShutdownTimer)
			if (compiler === build) compiler = null
		}
	}
	const launchBackend = async (binary: string, generation: number) => {
		await requireFreePort(backend)
		const application = await launchDevApplication(
			{ file: binary },
			{
				cwd: root,
				env: toolchainEnv({
					PORT: String(backend),
					// Dev same-origin: Vite (:port) POSTs through the proxy with
					// `Origin: http://localhost:<port>` — opt it in so the §10
					// CSRF guard (403 on foreign non-GET/HEAD) lets it through.
					SWELTE_CORS_ORIGIN: process.env.SWELTE_CORS_ORIGIN ?? `http://localhost:${port}`,
					// Item pass-through: config knobs → backend env (env wins
					// when already set, same rule as the §11 knobs).
					...(!process.env.SWELTE_METHOD_OVERRIDE && cfg.methodOverride
						? { SWELTE_METHOD_OVERRIDE: '1' }
						: {}),
					...(!process.env.SWELTE_TRAILING_SLASH && cfg.trailingSlash !== 'ignore'
						? { SWELTE_TRAILING_SLASH: cfg.trailingSlash }
						: {}),
					...(!process.env.SWELTE_CSRF_CHECK_ORIGIN && cfg.csrf === 'enforce'
						? { SWELTE_CSRF_CHECK_ORIGIN: '1' }
						: {}),
					// SSR sidecar: Hand proxies renders when set, skips when not.
					// maybeStartSsrSidecar below already preferred an explicit
					// env value — only fill it in when we started the sidecar.
					...(!process.env.SWELTE_SSR_URL && ssrSidecar ? { SWELTE_SSR_URL: ssrSidecar.url } : {}),
					...(!process.env.SWELTE_VERSION && cfg.version !== ''
						? { SWELTE_VERSION: cfg.version }
						: {}),
				}),
				stdio: ['ignore', 'pipe', 'pipe'],
			},
			{ generation, shutdownMs, log: ctx.log }
		)
		const child = application.child
		child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[v:${backend}] ${d}`))
		child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[v:${backend}] ${d}`))
		void application.exited.then(({ code, signal }) => {
			if (!stopping && (code !== 0 || signal))
				ctx.log(`V backend exited (${signal ?? `code ${code}`})`)
		})
		return application
	}
	const restartBackend = () => {
		if (!stopping) void controller?.restart()
	}
	const queueRestart = () => {
		clearTimeout(timer)
		timer = setTimeout(restartBackend, 300)
	}
	const onKey = (chunk: Buffer) => {
		for (const key of chunk.toString().toLowerCase()) {
			if (key === 'r' && ready) restartBackend()
			else if (key === 'u' && ready && !stopping) {
				void controller?.restartUi(async () => {
					ctx.log('restarting Vite...')
					await ui!.restart()
				})
			} else if (key === 'q' || key === '\u0003') stop()
		}
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
	try {
		if (process.stdin.isTTY) {
			process.stdin.setRawMode?.(true)
			process.stdin.on('data', onKey)
			process.stdin.resume()
		}
		// Heal a dangling bridge before Vite generates the native harness.
		try {
			const { healDanglingBridge: heal } = await import('../toolchain.js')
			if (heal(genAbs)) {
				ctx.log(
					'dangling QJS bridge (missing libqjs.a) removed — dev uses sidecar SSR until the next `swelte build`'
				)
			}
		} catch {
			/* ignore */
		}
		if (stopping) return
		ui = await startDevVite(
			root,
			port,
			toolchainEnv({
				PORT: String(port),
				SWELTE_V_BACKEND_URL: `http://localhost:${backend}`,
				VITE_SWELTE_V_BACKEND_URL: `http://localhost:${backend}`,
			})
		)
		if (stopping) return
		sessionDir = mkdtempSync(join(genAbs, 'dev-server-'))
		// Engine-agnostic SSR: when `@swelte/ssr-qjs` is installed, boot its
		// dev sidecar (`.swelte/dev/render.js` over HTTP) and hand the URL to
		// the V backend via SWELTE_SSR_URL. Needs `.swelte/ssr-manifest.json`,
		// so this runs after Vite initializes its configured plugins.
		// SPA-only projects (or an explicit --no-ssr) skip this —
		// static/SPA/JSON, unchanged. Explicit SWELTE_SSR_URL in the
		// environment always wins (e.g. external renderer).
		try {
			const ssrOpt =
				ctx.opts.ssr === false || (ctx.opts as Record<string, unknown>)['no-ssr'] === true
					? false
					: undefined
			const ssrPortRaw = ctx.opts['ssr-port']
			ssrSidecar = await maybeStartSsrSidecar(
				root,
				{
					...(typeof ssrPortRaw === 'number' && Number.isFinite(ssrPortRaw) && ssrPortRaw > 0
						? { ssrPort: Math.floor(ssrPortRaw) }
						: {}),
					...(ssrOpt === false ? { ssr: false as const } : {}),
				},
				ctx.log
			)
		} catch {
			/* sidecar is best-effort — dev works without it */
		}
		if (stopping) return
		controller = new DevBackend({
			build: buildBackend,
			launch: launchBackend,
			discard: (binary) => rm(binary, { force: true }),
			log: ctx.log,
		})
		// Watch before compiling so edits during startup supersede that candidate.
		for (const dir of [cfg.routesDir, cfg.libDir]) {
			const abs = join(root, dir)
			if (existsSync(abs)) watchHandles.push(watchVRecursive(abs, queueRestart))
		}
		const src = join(root, 'src')
		if (existsSync(src))
			watchHandles.push(
				watch(src, (_event, file) => {
					if (file === 'app.v' || file === 'matchers.v') queueRestart()
				})
			)
		ready = true
		await controller.restart()
		if (stopping) return
		ctx.log(`ready: http://localhost:${port} (V backend :${backend})`)
		if (process.stdin.isTTY) ctx.log('shortcuts: [r]estart V · [u]i restart Vite · [q]uit')

		await done
	} catch (error) {
		if (!stopping) throw error
	} finally {
		stopping = true
		clearTimeout(timer)
		for (const handle of watchHandles) handle.close()
		process.stdin.off('data', onKey)
		if (process.stdin.isTTY) {
			process.stdin.setRawMode?.(originalRawMode)
			process.stdin.pause()
		}
		// Keep rendering/proxy resources alive until admitted native work drains.
		const cleanup = await Promise.allSettled([controller?.stop()])
		cleanup.push(...(await Promise.allSettled([ui?.close(), ssrSidecar?.close()])))
		clearTimeout(compilerShutdownTimer)
		if (sessionDir && cleanup.every((result) => result.status === 'fulfilled')) {
			await rm(sessionDir, { recursive: true, force: true })
		}
		for (const result of cleanup) {
			if (result.status === 'rejected') ctx.log(`cleanup failed: ${String(result.reason)}`)
		}
		process.off('SIGINT', stop)
		process.off('SIGTERM', stop)
	}
}
