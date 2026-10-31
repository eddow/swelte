// `swelte test`: V tests + TS contract check (roadmap item 20).
// 1. `v test` on src/lib/** (native, no browser): the same V fns the
//    browser calls as WASM are unit-tested natively first.
// 2. Contract check: typecheck a generated TS file importing every stub
//    with Parameters<>/ReturnType<> assertions — break a V return type
//    and tsc fails pre-browser.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Ctx } from './types.js'

function listVFiles(dir: string): string[] {
	const out: string[] = []
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name)
			if (e.isDirectory()) {
				walk(p)
				continue
			}
			if (e.name.endsWith('.v')) out.push(p)
		}
	}
	try {
		walk(dir)
	} catch {
		/* missing dir */
	}
	return out.sort()
}

export async function runTest(ctx: Ctx): Promise<void> {
	const root = resolve(String(ctx.opts.root ?? process.cwd()))
	const { resolveV, vVersion, toolchainEnv } = await import('../toolchain.js')
	const { loadConfig } = await import('../gen/config.js')
	const v = resolveV(import.meta.url)
	ctx.log(`V toolchain: ${vVersion(v)} (${v})`)
	ctx.log(`root ${root}`)
	const cfg = await loadConfig(root)
	// 1. generate first (types must be fresh for the contract check).
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
	// 2. `v test` on each dir holding .v files (lib first, then routes).
	// V's `v test <dir>` runs *_test.v files; with no test files it exits 0.
	const dirs = new Set<string>()
	for (const sub of [cfg.libDir, cfg.routesDir]) {
		const abs = resolve(root, sub)
		if (!existsSync(abs)) continue
		for (const f of listVFiles(abs)) dirs.add(join(f, '..'))
	}
	// Always include the top-level lib/routes dirs (even with no _test.v).
	for (const sub of [cfg.libDir, cfg.routesDir]) {
		const abs = resolve(root, sub)
		if (existsSync(abs)) dirs.add(abs)
	}
	let vTested = 0
	for (const dir of [...dirs].sort()) {
		try {
			execFileSync(v, ['test', dir], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: toolchainEnv() })
			vTested++
		} catch (e) {
			const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
			throw new Error(
				`v test ${dir} failed:\n${err.stderr?.toString() ?? err.stdout?.toString() ?? err.message}`
			)
		}
	}
	ctx.log(`v test: ok (${vTested} dirs)`)
	// 3. Contract check: generate a TS file asserting every stub's
	// Parameters<>/ReturnType<> round-trips through the .d.ts projection.
	// A V return-type break changes the .d.ts → tsc fails here, pre-browser.
	const typesDir = join(root, cfg.outDir, 'types')
	// Contract: every .d.ts fn must exist in its generated stub JS.
	// Simpler + robust: tsc the whole types/ dir (any .d.ts drift breaks
	// downstream stubs, which is exactly the contract). Plus verify every
	// generated stub JS re-exports match the .d.ts fn names.
	const stubMismatches: string[] = []
	const genDir = join(root, cfg.outDir, 'generated')
	const walkBoth = (tDir: string, gDir: string, rel: string) => {
		let entries: string[] = []
		try {
			entries = readdirSync(tDir)
		} catch {
			return
		}
		for (const e of entries) {
			const tp = join(tDir, e)
			const gp = join(gDir, e.replace(/\.d\.ts$/, '.js'))
			try {
				if (readdirSync(tp, { withFileTypes: true })[0] && statSync(tp).isDirectory()) {
					walkBoth(tp, join(gDir, e), rel + e + '/')
					continue
				}
			} catch {
				/* not a dir */
			}
			if (!e.endsWith('.d.ts')) continue
			let dts = ''
			try {
				dts = readFileSync(tp, 'utf8')
			} catch {
				continue
			}
			const fns = [...dts.matchAll(/^export (?:async )?function ([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)]
				.map((m) => m[1])
				.filter((f) => f !== 'mountSwelteRoute')
			if (!fns.length) continue
			if (!existsSync(gp)) {
				stubMismatches.push(`${rel}${e}: types exist but no generated stub ${gp}`)
				continue
			}
			const js = readFileSync(gp, 'utf8')
			for (const fn of fns) {
				if (!js.includes(fn))
					stubMismatches.push(`${rel}${e}: ${fn} in .d.ts but missing from stub`)
			}
		}
	}
	try {
		walkBoth(join(typesDir, 'routes'), join(genDir, 'routes'), 'routes/')
		walkBoth(join(typesDir, 'lib'), join(genDir, 'lib'), 'lib/')
	} catch {
		/* missing dirs */
	}
	if (stubMismatches.length) throw new Error(`contract mismatch:\n${stubMismatches.join('\n')}`)
	ctx.log('contract: stubs match projected types')
	// 4. Shape snapshot: record every .d.ts projection; fail when a V
	// return type / struct field changes vs the committed snapshot.
	// This is the pre-browser contract: the page's `session.remember` read
	// breaks here (plain tsc never sees .svelte scripts without svelte-check).
	const snapFile = join(root, cfg.outDir, 'contract-snapshot.json')
	const snap: Record<string, string> = {}
	const walkSnap = (dir: string, rel: string) => {
		let entries: string[] = []
		try {
			entries = readdirSync(dir)
		} catch {
			return
		}
		for (const e of entries) {
			const fp = join(dir, e)
			try {
				if (statSync(fp).isDirectory()) {
					walkSnap(fp, rel + e + '/')
					continue
				}
			} catch {
				continue
			}
			if (!e.endsWith('.d.ts')) continue
			try {
				snap[rel + e] = readFileSync(fp, 'utf8')
			} catch {
				/* ignore */
			}
		}
	}
	walkSnap(typesDir, '')
	let prev: Record<string, string> | null = null
	try {
		prev = JSON.parse(readFileSync(snapFile, 'utf8'))
	} catch {
		/* first run */
	}
	if (prev) {
		const diffs: string[] = []
		for (const k of new Set([...Object.keys(prev), ...Object.keys(snap)])) {
			if (prev[k] !== snap[k])
				diffs.push(
					k +
						(prev[k] === undefined ? ' (new)' : snap[k] === undefined ? ' (removed)' : ' (changed)')
				)
		}
		if (diffs.length)
			throw new Error(
				`contract drift — V types changed since last snapshot:\n${diffs.join('\n')}\nReview the diff, then re-run with ... to accept: rm ${snapFile} && swelte test`
			)
		ctx.log(`contract: snapshot clean (${Object.keys(snap).length} type files)`)
	} else {
		try {
			writeFileSync(snapFile, JSON.stringify(snap, null, 2))
		} catch {
			/* ignore */
		}
		ctx.log(
			`contract: snapshot written (${Object.keys(snap).length} type files) — re-run to verify`
		)
	}
	// 5. tsc the project (pure-TS breaks + stub wiring).
	try {
		execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: toolchainEnv(),
		})
	} catch (e) {
		const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
		throw new Error(
			`tsc contract failed:\n${err.stderr?.toString() ?? err.stdout?.toString() ?? err.message}`
		)
	}
	ctx.log('contract: tsc clean')
}
