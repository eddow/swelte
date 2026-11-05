import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function vRoot(): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-snap-'))
	mkdirSync(join(root, 'src', 'routes'), { recursive: true })
	mkdirSync(join(root, 'src', 'lib'), { recursive: true })
	writeFileSync(join(root, 'package.json'), '{"name":"t","type":"module"}')
	writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
	writeFileSync(
		join(root, 'src', 'routes', '+page.v'),
		'module p\n@[rpc] pub fn greet(name string) string { return name }'
	)
	return root
}

async function generateAndTest(root: string, updateSnapshot: boolean): Promise<string[]> {
	const logs: string[] = []
	const { swelte } = await import('../vite.js')
	const plug = swelte({}) as unknown as {
		configResolved?: (c: { root: string }) => void
		buildStart?: () => Promise<void>
	}
	plug.configResolved?.({ root })
	await plug.buildStart?.()
	// Mirror runTest steps 3-4 without the V binary / tsc project check:
	const { join: pjoin } = await import('node:path')
	const { readdirSync, statSync } = await import('node:fs')
	const typesDir = pjoin(root, '.swelte', 'types')
	const snap: Record<string, string> = {}
	const walkSnap = (dir: string, rel: string) => {
		let entries: string[] = []
		try {
			entries = readdirSync(dir)
		} catch {
			return
		}
		for (const e of entries) {
			const fp = pjoin(dir, e)
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
	const snapFile = pjoin(root, 'swelte.contract.json')
	let prev: Record<string, string> | null = null
	try {
		prev = JSON.parse(readFileSync(snapFile, 'utf8'))
	} catch {
		/* first run */
	}
	if (prev && !updateSnapshot) {
		const diffs: string[] = []
		for (const k of new Set([...Object.keys(prev), ...Object.keys(snap)])) {
			if (prev[k] !== snap[k])
				diffs.push(
					k +
						(prev[k] === undefined ? ' (new)' : snap[k] === undefined ? ' (removed)' : ' (changed)')
				)
		}
		if (diffs.length)
			throw new Error(`contract drift — V types changed since last snapshot:\n${diffs.join('\n')}`)
		logs.push('clean')
	} else {
		writeFileSync(snapFile, JSON.stringify(snap, null, 2))
		logs.push('written')
	}
	return logs
}

describe('contract snapshot flow (tmp root, no V/tsc)', () => {
	it('write -> clean rerun -> drift names the file -> --update-snapshot rewrites', async () => {
		const root = vRoot()
		const snapFile = join(root, 'swelte.contract.json')
		assert.ok(!existsSync(snapFile))
		await generateAndTest(root, false)
		assert.ok(existsSync(snapFile))
		// clean rerun
		await generateAndTest(root, false)
		// edit one .v return -> drift names the file
		writeFileSync(
			join(root, 'src', 'routes', '+page.v'),
			'module p\n@[rpc] pub fn greet(name string) int { return 1 }'
		)
		const { swelte } = await import('../vite.js')
		const plug = swelte({}) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		let driftMsg = ''
		try {
			await generateAndTest(root, false)
			assert.fail('expected drift')
		} catch (e) {
			driftMsg = (e as Error).message
		}
		assert.ok(driftMsg.includes('contract drift'), driftMsg)
		// The snapshot key names a changed .d.ts file.
		assert.ok(/\.d\.ts.*\(changed\)/.test(driftMsg), driftMsg)
		// --update-snapshot rewrites; next run clean
		await generateAndTest(root, true)
		await generateAndTest(root, false)
	})
})

describe('item 12 — contract snapshot through real runTest (toolchain-gated)', () => {
	it('runTest writes snapshot, passes clean, flags drift, accepts update', async (t) => {
		const { resolveV } = await import('../toolchain.js')
		const v = resolveV(import.meta.url)
		let vOk = false
		try {
			const { execFileSync } = await import('node:child_process')
			execFileSync(v, ['version'], { stdio: ['ignore', 'pipe', 'pipe'] })
			vOk = true
		} catch {
			vOk = false
		}
		if (!vOk) {
			t.skip('V toolchain not installed (run `vvm install 0.5.2`) — real runTest needs it')
			return
		}
		const root = vRoot()
		// runTest step 5 shells `npx tsc -p tsconfig.json` with cwd=root:
		// a bare tmp root has no node_modules, so `npx tsc` resolves nothing.
		// Prepend the workspace .bin (hoisted typescript) to PATH so the
		// fixture's minimal tsconfig typechecks (contract step, not a full
		// app build). Resolve from this file's location, not the tmp root.
		const wsBin = '/home/fmdm/dev/swelte/node_modules/.bin'
		if (!(process.env.PATH ?? '').split(':').includes(wsBin)) {
			process.env.PATH = `${wsBin}:${process.env.PATH ?? ''}`
		}
		// npx resolves tsc from cwd's node_modules, ignoring PATH — symlink
		// the workspace install into the fixture so `npx tsc` finds it.
		const { symlinkSync } = await import('node:fs')
		try {
			symlinkSync('/home/fmdm/dev/swelte/node_modules', join(root, 'node_modules'))
		} catch {
			/* already linked */
		}
		writeFileSync(
			join(root, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					allowJs: true,
					checkJs: false,
				},
				include: ['src/**/*.ts', '.swelte/types/**/*', '.swelte/v-shim.d.ts'],
			})
		)
		writeFileSync(join(root, 'src', 'probe.ts'), 'export const probe = 1;\n')
		const { runTest } = await import('./test.js')
		const logs: string[] = []
		const ctx = (opts: Record<string, string | number | boolean>) => ({
			argv: [] as string[],
			opts,
			rest: [] as string[],
			log: (m: string) => logs.push(m),
			error: (m: string) => logs.push(m),
		})
		// first run writes the snapshot (no --update-snapshot needed: no prev)
		await runTest(ctx({ root }))
		assert.ok(existsSync(join(root, 'swelte.contract.json')))
		assert.ok(logs.join('\n').includes('snapshot written'), logs.join('\n'))
		// clean rerun: snapshot clean + tsc clean
		logs.length = 0
		await runTest(ctx({ root }))
		assert.ok(logs.join('\n').includes('snapshot clean'), logs.join('\n'))
		// edit one .v return -> drift error names the file
		writeFileSync(
			join(root, 'src', 'routes', '+page.v'),
			'module p\n@[rpc] pub fn greet(name string) int { return 1 }'
		)
		await assert.rejects(() => runTest(ctx({ root })), /contract drift/)
		// accept with --update-snapshot; next run clean
		logs.length = 0
		await runTest(ctx({ root, 'update-snapshot': true }))
		assert.ok(logs.join('\n').includes('snapshot written'), logs.join('\n'))
		logs.length = 0
		await runTest(ctx({ root }))
		assert.ok(logs.join('\n').includes('snapshot clean'), logs.join('\n'))
	})
})
