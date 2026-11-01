// `swelte build`: typecheck -> generate -> `vite build` -> `v -o` server binary.
// The V binary serves dist/ + API (single artifact, no Node at runtime).
// Roadmap §6: prod WASM bundle compiles in the plugin's generateBundle
// hook (`v -b wasm -os browser` → dist/assets/app_lib-*.wasm, exactly
// one *.wasm in dist/assets/ — the [swelte] log line proves it).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Ctx } from './types.js'
import { killPort, portFree, takePort, waitPort } from './dev.js'

function listDevWasm(root: string): string[] {
	try {
		const devDir = join(root, '.swelte', 'dev')
		const out: string[] = []
		const walk = (dir: string) => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const q = join(dir, e.name)
				if (e.isDirectory()) {
					walk(q)
					continue
				}
				if (e.name.endsWith('.wasm')) out.push(q + ' (' + statSync(q).size + 'B)')
			}
		}
		walk(devDir)
		return out.length > 0 ? ['wasm dev: ' + out.join(', ')] : ['wasm dev: (no #lib/ modules)']
	} catch {
		return ['wasm dev: (no #lib/ modules)']
	}
}

export async function runBuild(ctx: Ctx): Promise<void> {
	const root = resolve(String(ctx.opts.root ?? process.cwd()))
	const outBinary = String(ctx.opts.output ?? join(root, 'dist', 'server'))
	const { resolveV, vVersion, toolchainEnv, resolveCC } = await import('../toolchain.js')
	const { loadConfig } = await import('../gen/config.js')
	const v = resolveV(import.meta.url)
	ctx.log(`V toolchain: ${vVersion(v)} (${v})`)
	ctx.log(`root ${root}`)
	const cfg = await loadConfig(root)
	const genAbs = join(root, cfg.outDir)
	// 1. generate into .swelte/ (routes/*.v + server_gen.v + server.v harness).
	try {
		const { swelte } = await import('../vite.js')
		const plug = swelte({}) as unknown as {
			buildStart?: () => Promise<void> | void
			configResolved?: (c: { root: string }) => void
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		ctx.log('generated .swelte/')
	} catch (e) {
		throw new Error(`codegen failed: ${(e as Error).message}`)
	}
	// Single `v -o`: it typechecks as it compiles (0.5.2 has no `v check`).
	// The old flow ran a throwaway typecheck compile first — same errors,
	// double the slowest step. Target the harness FILE (`.swelte/server.v`):
	// V resolves `routes/` relative to it (targeting the dir fails — V
	// skips dotted dirs).
	// 2. WASM (roadmap §6): compiled live by the plugin - the generate()
	// above emits .swelte/dev/<mod>.wasm per file (mtime-guarded); the
	// prod bundle compiles in generateBundle during vite build below.
	for (const line of listDevWasm(root)) ctx.log(line)
	// 3. vite build FIRST (it wipes dist/, incl. any binary inside it).
	// (Adapter generateBundle emits dist/ssr/render.js + the QJS bridge
	// here when the project uses @swelte/ssr-qjs — the smoke in step 5
	// picks it up.)
	try {
		execFileSync('npx', ['vite', 'build'], { cwd: root, encoding: 'utf8', env: toolchainEnv() })
	} catch (e) {
		const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
		throw new Error(
			`vite build failed:\n${err.stderr?.toString() ?? err.stdout?.toString() ?? err.message}`
		)
	}
	ctx.log('vite build: ok')
	// 3b. QJS prod link, second generate pass (adapter-owned): the bridge
	// (routes/swelte_qjs_bridge.v) did not exist during step 1 (it is
	// emitted by generateBundle above) — regenerate so server_gen.v +
	// server.v compile against it. Core-only projects: generate() is
	// idempotent, no bridge, no QJS. Then rebuild libqjs.a (mtime-guarded).
	try {
		const { swelte } = await import('../vite.js')
		const plug = swelte({}) as unknown as {
			buildStart?: () => Promise<void> | void
			configResolved?: (c: { root: string }) => void
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		ctx.log('regenerated .swelte/ (QJS bridge pass)')
	} catch (e) {
		throw new Error(`codegen (QJS pass) failed: ${(e as Error).message}`)
	}
	// 4. `v -o` the server binary into dist/ AFTER the wipe (dist-adjacent,
	// never the project root). Target the harness file (see typecheck).
	// QJS projects need -enable-globals (bridge cache) + system cc (V's
	// bundled tcc cannot compile quickjs.c — but we link the prebuilt
	// .a, so any cc works; gcc preferred).
	// Conda-safe: absolute cc path + conda-free PATH (conda's ld shadows
	// the system linker and breaks every V C-link step).
	// Detect: bridge file present → QJS flags.
	let vExtra: string[] = []
	try {
		const { existsSync } = await import('node:fs')
		if (existsSync(join(genAbs, 'routes', 'swelte_qjs_bridge.v'))) {
			vExtra = ['-enable-globals', '-cc', resolveCC()]
			ctx.log(`QJS embed: -enable-globals -cc ${vExtra[vExtra.length - 1]} (bridge present)`)
		}
	} catch {
		/* core-only */
	}
	try {
		execFileSync(v, ['-o', outBinary, ...vExtra, join(genAbs, 'server.v')], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: toolchainEnv(),
		})
	} catch (e) {
		const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
		throw new Error(
			`v -o failed: ${err.stderr?.toString() ?? err.stdout?.toString() ?? err.message}` +
				`\n(hint: conda on PATH ships a conflicting ld — build strips conda dirs; if this persists, run with a clean PATH or conda deactivate)`
		)
	}
	ctx.log(`V binary: ${outBinary}`)
	// 5. Smoke: boot the binary, probe page + API, stop. Engine-agnostic:
	// static shell + JSON only. SSR HTML is the adapter's proof (its own
	// check boots the sidecar + asserts markers) — core never imports or
	// starts an engine. If SWELTE_SSR_URL happens to be set in the env,
	// Hand will proxy (its contract), but core sets nothing.
	const probePort = takePort(ctx.opts.port, 4173)
	await killPort(probePort, ctx.log)
	// Portable probe helper (no curl): fetch with a hard timeout.
	const probeGet = async (path: string, accept: string): Promise<{ status: number; body: string }> => {
		const ctrl = new AbortController()
		const t = setTimeout(() => ctrl.abort(), 5000)
		try {
			const res = await fetch(`http://127.0.0.1:${probePort}${path}`, {
				headers: { accept },
				signal: ctrl.signal,
			})
			return { status: res.status, body: await res.text() }
		} finally {
			clearTimeout(t)
		}
	}
	const hasGreetRoute =
		existsSync(join(root, cfg.routesDir, 'api', 'greet.v')) ||
		existsSync(join(root, cfg.routesDir, 'api', 'greet', '+page.v')) ||
		existsSync(join(root, cfg.routesDir, 'api', 'greet', 'index.v'))
	const child = (await import('node:child_process')).spawn(outBinary, [], {
		cwd: root,
		env: {
			...process.env,
			PORT: String(probePort),
			SWELTE_DIST: 'dist',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let logged = ''
	child.on('error', (e: Error) => {
		logged += `\nspawn failed: ${(e as Error).message}`
	})
	child.stderr?.on('data', (d: Buffer) => {
		logged += d.toString()
	})
	child.stdout?.on('data', (d: Buffer) => {
		logged += d.toString()
	})
	try {
		if (!(await waitPort(probePort, 15000)))
			throw new Error(`built binary did not listen on :${probePort} within 15s\n${logged}`)
		const page = await probeGet('/', 'text/html')
		if (page.status !== 200) throw new Error(`smoke page: HTTP ${page.status} (want 200)\n${logged}`)
		// Empty scaffold has no api/greet.v — only probe the API when the
		// route exists; otherwise the page probe + JSON check is the smoke.
		if (hasGreetRoute) {
			const api = await probeGet('/api/greet?payload=%22w%22', 'application/json')
			if (!api.body.includes('Hello'))
				throw new Error(`smoke api: unexpected body ${api.body}\n${logged}`)
			ctx.log(`smoke: page 200 + api ok (:${probePort})`)
		} else {
			const json = await probeGet('/', 'application/json')
			ctx.log(`smoke: page 200 (no api/greet route; json ${json.status}) (:${probePort})`)
		}
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
		// Best-effort port cleanup (Linux-only tool — skip elsewhere).
		await killPort(probePort, () => {})
	}
	ctx.log(`build done: ${outBinary} + dist/`)
}
