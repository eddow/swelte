import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function vRoot(): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-snap-'))
	mkdirSync(join(root, 'src', 'routes'), { recursive: true })
	mkdirSync(join(root, 'src', 'lib'), { recursive: true })
	writeFileSync(join(root, 'package.json'), '{"name":"t"}')
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
				diffs.push(k + (prev[k] === undefined ? ' (new)' : snap[k] === undefined ? ' (removed)' : ' (changed)'))
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
