// `swelte dev`: free ports, spawn `v run .` + Vite with injected
// `vBackendUrl`, restart V on `.v` change, kill both on Ctrl-C.
// Portable: no curl/ss/fuser/pkill required — best-effort Unix cleanup
// only (guarded try/catch), child handles + fetch probes otherwise.
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { basename, join, resolve } from 'node:path'
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

function isUnixLike(): boolean {
	return process.platform !== 'win32'
}

export async function killPort(port: number, log: (m: string) => void): Promise<void> {
	if (await portFree(port)) return
	log(`port ${port} busy — freeing it`)
	if (isUnixLike()) {
		// Best-effort: `ss` (Linux) pid lookup, then TERM. Missing tools
		// (macOS/Windows) fall through to the wait below.
		try {
			const { execFileSync } = await import('node:child_process')
			let out = ''
			try {
				out = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' }).toString()
			} catch {
				out = ''
			}
			const pids = new Set<string>()
			for (const line of out.split('\n')) {
				if (!line.includes(`:${port} `)) continue
				for (const m of line.matchAll(/pid=(\d+)/g)) pids.add(m[1])
			}
			for (const pid of pids) {
				try {
					process.kill(Number(pid), 'SIGTERM')
				} catch {
					/* ignore */
				}
			}
		} catch {
			/* ignore */
		}
	}
	const t0 = Date.now()
	while (!(await portFree(port)) && Date.now() - t0 < 8000) {
		await new Promise((r) => setTimeout(r, 200))
	}
	if (!(await portFree(port))) {
		log(`port ${port} still busy — proceeding anyway (stop the holder or pass --port)`)
	}
}

/** Best-effort Unix port cleanup after a child is killed (fuser is
 * Linux-only — skip elsewhere, never throw). */
export async function freePortUnix(port: number): Promise<void> {
	if (!isUnixLike()) return
	try {
		const { execFileSync } = await import('node:child_process')
		execFileSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' })
	} catch {
		/* ignore — child handles are the real cleanup */
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

/** Basename-derived kill-pattern for this project (never leaks the
 * checked-in example path into user projects). Only used on Unix. */
export function projectKillPattern(root: string): string {
	return basename(resolve(root))
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
	const { resolveV, vVersion, toolchainEnv, resolveHostCC, needsGlobals, hasRealBridge } =
		await import('../toolchain.js')
	const { loadConfig } = await import('../gen/config.js')
	const v = resolveV(import.meta.url)
	ctx.log(`V toolchain: ${vVersion(v)} (${v})`)
	ctx.log(`root ${root}`)
	const cfg = await loadConfig(root)
	const genAbs = join(root, cfg.outDir)
	await killPort(port, ctx.log)
	await killPort(backend, ctx.log)
	const viteConfig = findViteConfig(root)
	if (!viteConfig) throw new Error(`no vite.config.* in ${root} (swelte dev needs one)`)
	if (!hasSweltePlugin(root, viteConfig)) {
		ctx.log(`warning: ${viteConfig} does not reference the swelte() plugin`)
	}
	let vChild: ChildProcess | null = null
	let viteChild: ChildProcess | null = null

	let restarts = 0
	let stopping = false
	const killBackend = () =>
		new Promise<void>((resolveKill) => {
			const child = vChild
			vChild = null
			const waitPortFree = async () => {
				const t0 = Date.now()
				while (!(await portFree(backend)) && Date.now() - t0 < 10000) {
					await new Promise((r) => setTimeout(r, 200))
				}
				resolveKill()
			}
			if (!child || child.exitCode !== null || child.signalCode !== null) {
				void waitPortFree()
				return
			}
			const done = () => {
				void waitPortFree()
			}
			child.once('exit', done)
			try {
				child.kill('SIGTERM')
			} catch {
				/* ignore */
			}
			// `v run` wrapper exit does not mean the compiled binary released
			// the port — best-effort Unix cleanup, then wait.
			setTimeout(() => {
				void freePortUnix(backend)
			}, 400).unref?.()
			setTimeout(() => {
				try {
					child.kill('SIGKILL')
				} catch {
					/* ignore */
				}
			}, 3000).unref?.()
			setTimeout(done, 4000).unref?.()
		})
	const spawnBackend = () => {
		if (stopping) return
		// Run the harness FILE: `v run .swelte/server.v` — V resolves
		// `routes/` relative to it (dir target fails on dotted dirs).
		// Compiler flags go BEFORE `run` (after it they reach the program
		// as argv — hence `v expects that -enable-globals exists`).
		// Bridge pass: the real QJS bridge uses __global, so dev needs the
		// `-enable-globals -cc <abs>` pair the build uses when it exists.
		// Plugin V modules (db backend) need `-enable-globals` too (marker).
		// Stub bridge / neither: plain `v run` (symbol always resolves).
		// (Dangling bridges are healed once at startup, before pre-generate.)
		// Host cc prefers the system compiler, falls back to the vvm-managed
		// host zig-cc wrapper (stock Windows/macOS: no gcc).
		let vArgs: string[] = ['run', join(genAbs, 'server.v')]
		try {
			const withGlobals = needsGlobals(genAbs)
			const hasBridge = hasRealBridge(genAbs)
			if (hasBridge) {
				const cc = resolveHostCC(import.meta.url)
				if (!cc) {
					throw new Error(
						'no C compiler: install gcc/clang or run `npx vvm prepare` (writes the host zig-cc wrapper)'
					)
				}
				vArgs = ['-enable-globals', '-cc', cc, 'run', join(genAbs, 'server.v')]
				ctx.log(`QJS embed: -enable-globals -cc ${vArgs[2]} (bridge present)`)
			} else if (withGlobals) {
				vArgs = ['-enable-globals', 'run', join(genAbs, 'server.v')]
				ctx.log('plugin V modules: -enable-globals (__global in includes)')
			}
		} catch (e) {
			if ((e as Error).message?.includes('no C compiler')) throw e
			/* core-only */
		}
		vChild = spawn(v, vArgs, {
			cwd: root,
			env: toolchainEnv({
				PORT: String(backend),
				// Dev same-origin: Vite (:port) POSTs through the proxy with
				// `Origin: http://localhost:<port>` — opt it in so the §10
				// CSRF guard (403 on foreign non-GET/HEAD) lets it through.
				SWELTE_CORS_ORIGIN: process.env.SWELTE_CORS_ORIGIN ?? `http://localhost:${port}`,
				// Item pass-through: config knobs → backend env (env wins
				// when already set, same rule as the §11 knobs).
				...(!process.env.SWELTE_TRAILING_SLASH && cfg.trailingSlash !== 'ignore'
					? { SWELTE_TRAILING_SLASH: cfg.trailingSlash }
					: {}),
				...(!process.env.SWELTE_CSRF_CHECK_ORIGIN && cfg.csrf === 'enforce'
					? { SWELTE_CSRF_CHECK_ORIGIN: '1' }
					: {}),
				...(!process.env.SWELTE_METHOD_OVERRIDE && cfg.methodOverride
					? { SWELTE_METHOD_OVERRIDE: '1' }
					: {}),
				...(!process.env.SWELTE_VERSION && cfg.version !== ''
					? { SWELTE_VERSION: cfg.version }
					: {}),
			}),
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		onSpawnError(vChild, 'V backend', ctx.log)
		vChild.stdout?.on('data', (d: Buffer) => process.stdout.write(`[v:${backend}] ${d}`))
		vChild.stderr?.on('data', (d: Buffer) => process.stderr.write(`[v:${backend}] ${d}`))
		vChild.on('exit', (code) => {
			vChild = null
			if (!stopping) ctx.log(`V backend exited (code ${code}) — edit a .v file or restart dev`)
		})
	}
	// `generate()` runs in Vite's configResolved — but `swelte dev` starts
	// the V backend *before* Vite. Heal a dangling bridge FIRST (real
	// bridge, missing libqjs.a) so the pre-generate below writes the stub
	// and the backend boots; run it once here so `.swelte/` exists.
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
	try {
		const { swelte } = await import('../vite.js')
		const plug = swelte({}) as unknown as {
			buildStart?: () => Promise<void> | void
			configResolved?: (c: { root: string }) => void
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		ctx.log('generated .swelte/ (pre-Vite)')
	} catch (e) {
		ctx.log(`warning: pre-generate failed: ${(e as Error).message}`)
	}
	// Engine-agnostic: SWELTE_SSR_URL comes from the environment when the
	// user (or an adapter wrapper) runs a renderer beside the V backend.
	// Core starts nothing — static/SPA/JSON when unset.
	spawnBackend()
	const backendUp = await waitPort(backend, 30000)
	if (!backendUp) {
		try {
			;(vChild as ChildProcess | null)?.kill('SIGTERM')
		} catch {
			/* ignore */
		}
		throw new Error(`V backend did not come up on :${backend} within 30s`)
	}
	const spawnVite = () => {
		if (stopping) return
		viteChild = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
			cwd: root,
			env: toolchainEnv({
				PORT: String(port),
				SWELTE_V_BACKEND_URL: `http://localhost:${backend}`,
				VITE_SWELTE_V_BACKEND_URL: `http://localhost:${backend}`,
			}),
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		onSpawnError(viteChild, 'Vite', ctx.log)
		viteChild.stdout?.on('data', (d: Buffer) => process.stdout.write(`[vite:${port}] ${d}`))
		viteChild.stderr?.on('data', (d: Buffer) => process.stderr.write(`[vite:${port}] ${d}`))
		viteChild.on('exit', (code) => {
			viteChild = null
			if (!stopping) ctx.log(`Vite exited (code ${code}) — stopping`)
		})
	}
	spawnVite()
	const viteUp = await waitPort(port, 60000)
	if (!viteUp) ctx.log(`Vite did not come up on :${port} within 60s — check output above`)
	else ctx.log(`ready: http://localhost:${port} (V backend :${backend})`)
	let timer: NodeJS.Timeout | null = null
	const watchHandles: { close: () => void }[] = []
	const queueRestart = (where: string) => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			void (async () => {
				restarts += 1
				ctx.log(`.v changed (${where}) — restarting V backend (#${restarts})`)
				await killBackend()
				spawnBackend()
			})()
		}, 300)
	}
	// cfg-relative (not hardcoded src/): manual per-subdir watchers so
	// Linux (no recursive fs.watch) sees nested routes/** changes.
	for (const dir of [cfg.routesDir, cfg.libDir]) {
		const abs = join(root, dir)
		if (!existsSync(abs)) continue
		watchHandles.push(watchVRecursive(abs, (file) => queueRestart(`${dir}/${file}`)))
	}
	await new Promise<void>((resolveDone) => {
		const stop = () => {
			if (stopping) return
			stopping = true
			if (timer) clearTimeout(timer)
			for (const w of watchHandles) {
				try {
					w.close()
				} catch {
					/* ignore */
				}
			}
			try {
				process.stdin.pause()
			} catch {
				/* ignore */
			}
			try {
				process.stdin.removeAllListeners('data')
			} catch {
				/* ignore */
			}
			ctx.log('shutting down...')
			void (async () => {
				// Kill by child handle first (portable). Unix extras are
				// best-effort: fuser frees re-parented listeners, pkill
				// catches anything still matching our exact invocation.
				const killAll = (sig: 'TERM' | 'KILL') => {
					try {
						viteChild?.kill(sig === 'KILL' ? 'SIGKILL' : 'SIGTERM')
					} catch {
						/* ignore */
					}
					try {
						vChild?.kill(sig === 'KILL' ? 'SIGKILL' : 'SIGTERM')
					} catch {
						/* ignore */
					}
					if (process.platform !== 'win32') {
						void freePortUnix(port).then(() => freePortUnix(backend))
						const pats =
							process.platform === 'linux'
								? [`vite --port ${port}`, `PORT=${backend} `, projectKillPattern(root)]
								: [`vite --port ${port}`]
						void import('node:child_process').then(({ execFileSync }) => {
							for (const pat of pats) {
								try {
									execFileSync('pkill', [`-${sig}`, '-f', pat], { stdio: 'ignore' })
								} catch {
									/* ignore */
								}
							}
						})
					}
				}
				killAll('TERM')
				await killBackend()
				setTimeout(() => {
					killAll('KILL')
					resolveDone()
				}, 1500)
			})()
		}
		process.once('SIGINT', stop)
		process.once('SIGTERM', stop)
		// Interactive shortcuts (TTY only — signals always work). `r` restarts
		// the V backend (Vite keeps HMR state), `u` restarts Vite, `q` quits.
		// Children run with stdio ignore, so keys never reach Vite's own
		// reader; these are ours, not forwarded.
		if (process.stdin.isTTY) {
			ctx.log('shortcuts: [r]estart V · [u]i restart Vite · [q]uit')
			const onKey = (chunk: Buffer) => {
				const key = (chunk.toString()[0] ?? '').toLowerCase()
				if (key === 'r') {
					void (async () => {
						restarts += 1
						ctx.log(`restarting V backend (#${restarts})`)
						await killBackend()
						spawnBackend()
					})()
				} else if (key === 'u') {
					void (async () => {
						ctx.log('restarting Vite...')
						try {
							viteChild?.kill('SIGTERM')
						} catch {
							/* ignore */
						}
						await freePortUnix(port)
						setTimeout(spawnVite, 800)
					})()
				} else if (key === 'q') {
					process.stdin.off('data', onKey)
					stop()
				}
			}
			process.stdin.on('data', onKey)
			try {
				process.stdin.setRawMode?.(false)
			} catch {
				/* ignore */
			}
			process.once('exit', () => {
				process.stdin.off('data', onKey)
			})
		}
	})
}
