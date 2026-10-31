// `swelte build`: typecheck -> generate -> `vite build` -> `v -o` server binary.
// The V binary serves dist/ + API (single artifact, no Node at runtime).
// Roadmap §6: prod WASM bundle compiles in the plugin's generateBundle
// hook (`v -b wasm -os browser` → dist/assets/app_lib-*.wasm, exactly
// one *.wasm in dist/assets/ — the [swelte] log line proves it).
import { execFileSync, execSync } from 'node:child_process'
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
	const { resolveV, vVersion } = await import('../toolchain.js')
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
	// (Adapter generateBundle emits dist/ssr/render.js here when the
	// project uses @swelte/ssr-qjs — the smoke in step 5 picks it up.)
	try {
		execFileSync('npx', ['vite', 'build'], { cwd: root, encoding: 'utf8' })
	} catch (e) {
		const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
		throw new Error(
			`vite build failed:\n${err.stderr?.toString() ?? err.stdout?.toString() ?? err.message}`
		)
	}
	ctx.log('vite build: ok')
	// 4. `v -o` the server binary into dist/ AFTER the wipe (dist-adjacent,
	// never the project root). Target the harness file (see typecheck).
	try {
		execFileSync(v, ['-o', outBinary, join(genAbs, 'server.v')], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
	} catch (e) {
		const err = e as { stderr?: Buffer; message?: string }
		throw new Error(`v -o failed: ${err.stderr?.toString() ?? err.message}`)
	}
	ctx.log(`V binary: ${outBinary}`)
	// 5. Smoke: boot the binary, probe page + API, stop. Engine-agnostic:
	// static shell + JSON only. SSR HTML is the adapter's proof (its own
	// check boots the sidecar + asserts markers) — core never imports or
	// starts an engine. If SWELTE_SSR_URL happens to be set in the env,
	// Hand will proxy (its contract), but core sets nothing.
	const probePort = takePort(ctx.opts.port, 4173)
	await killPort(probePort, ctx.log)
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
	child.stderr?.on('data', (d: Buffer) => {
		logged += d.toString()
	})
	child.stdout?.on('data', (d: Buffer) => {
		logged += d.toString()
	})
	try {
		if (!(await waitPort(probePort, 15000)))
			throw new Error(`built binary did not listen on :${probePort} within 15s\n${logged}`)
		const page = execSync(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${probePort}/`, {
			encoding: 'utf8',
		}).trim()
		const api = execSync(
			`curl -s -m 5 -H 'accept: application/json' 'http://localhost:${probePort}/api/greet?payload=%22w%22'`,
			{ encoding: 'utf8' }
		).trim()
		if (page !== '200') throw new Error(`smoke page: HTTP ${page} (want 200)\n${logged}`)
		if (!api.includes('Hello')) throw new Error(`smoke api: unexpected body ${api}\n${logged}`)
		ctx.log(`smoke: page 200 + api ok (:${probePort})`)
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
		try {
			execSync(`fuser -k ${probePort}/tcp 2>/dev/null || true`)
		} catch {
			/* ignore */
		}
	}
	ctx.log(`build done: ${outBinary} + dist/`)
}
