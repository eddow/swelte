// `swelte dev`: free ports, spawn `v run .` + Vite with injected
// `vBackendUrl`, restart V on `.v` change, kill both on Ctrl-C.
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { existsSync, readFileSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
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

export async function killPort(port: number, log: (m: string) => void): Promise<void> {
	if (await portFree(port)) return
	log(`port ${port} busy — freeing it`)
	try {
		const { execSync } = await import('node:child_process')
		const out = execSync(`ss -ltnp 2>/dev/null | grep -E ':${port} ' || true`).toString()
		const pids = new Set<string>()
		for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(m[1])
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
	const t0 = Date.now()
	while (!(await portFree(port)) && Date.now() - t0 < 8000) {
		await new Promise((r) => setTimeout(r, 200))
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

export async function runDev(ctx: Ctx): Promise<void> {
	const root = resolve(String(ctx.opts.root ?? process.cwd()))
	const port = takePort(ctx.opts.port, 5174)
	const backend = takePort(ctx.opts.backend, 8131)
	const { resolveV, vVersion } = await import('../toolchain.js')
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
			// the port — kill whoever still holds :backend, then wait.
			setTimeout(() => {
				try {
					execSync(`fuser -k ${backend}/tcp 2>/dev/null || true`)
				} catch {
					/* ignore */
				}
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
		vChild = spawn(v, ['run', join(genAbs, 'server.v')], {
			cwd: root,
			env: {
				...process.env,
				PORT: String(backend),
				// Dev same-origin: Vite (:port) POSTs through the proxy with
				// `Origin: http://localhost:<port>` — opt it in so the §10
				// CSRF guard (403 on foreign non-GET/HEAD) lets it through.
				SWELTE_CORS_ORIGIN:
					process.env.SWELTE_CORS_ORIGIN ?? `http://localhost:${port}`,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		vChild.stdout?.on('data', (d: Buffer) => process.stdout.write(`[v:${backend}] ${d}`))
		vChild.stderr?.on('data', (d: Buffer) => process.stderr.write(`[v:${backend}] ${d}`))
		vChild.on('exit', (code) => {
			vChild = null
			if (!stopping) ctx.log(`V backend exited (code ${code}) — edit a .v file or restart dev`)
		})
	}
	// `generate()` runs in Vite's configResolved — but `swelte dev` starts
	// the V backend *before* Vite. Run it once here so `.swelte/` exists.
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
			env: {
				...process.env,
				PORT: String(port),
				SWELTE_V_BACKEND_URL: `http://localhost:${backend}`,
				VITE_SWELTE_V_BACKEND_URL: `http://localhost:${backend}`,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		})
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
	const watchers: ReturnType<typeof watch>[] = []
	for (const dir of ['src/routes', 'src/lib']) {
		const abs = join(root, dir)
		if (!existsSync(abs)) continue
		try {
			const w = watch(abs, { recursive: true }, (_ev, file) => {
				if (!file || !String(file).endsWith('.v')) return
				if (timer) clearTimeout(timer)
				timer = setTimeout(() => {
					void (async () => {
						restarts += 1
						ctx.log(`.v changed (${dir}/${file}) — restarting V backend (#${restarts})`)
						await killBackend()
						spawnBackend()
					})()
				}, 300)
			})
			watchers.push(w)
		} catch {
			/* ignore */
		}
	}
	await new Promise<void>((resolveDone) => {
		const stop = () => {
			if (stopping) return
			stopping = true
			if (timer) clearTimeout(timer)
			for (const w of watchers) {
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
				// Kill by port + command line, not by handle: `npx`/`v run`
				// wrappers re-parent the real servers (Vite keeps :port, the
				// compiled `something` binary keeps :backend), so ChildProcess
				// handles alone orphan them. fuser frees the listeners; pkill
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
					try {
						execSync(`fuser -k ${port}/tcp ${backend}/tcp 2>/dev/null || true`)
					} catch {
						/* ignore */
					}
					for (const pat of [
						`vite --port ${port}`,
						`PORT=${backend} `,
						'examples/something/something',
					]) {
						try {
							execSync(`pkill -${sig} -f '${pat}' 2>/dev/null || true`)
						} catch {
							/* ignore */
						}
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
						try {
							execSync(`fuser -k ${port}/tcp 2>/dev/null || true`)
						} catch {
							/* ignore */
						}
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
