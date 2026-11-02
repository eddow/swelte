// `swelte export`: snapshot the crawl (docs (built) item 6).
// Copies the prerender/entries crawl list + rendered dist/*.html +
// the contract snapshot into `<root>/snapshot/`. Reuses the crawl
// (no new enumeration) - packaging only.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Ctx } from './types.js'

export async function runExport(ctx: Ctx): Promise<void> {
	const root = resolve(String(ctx.opts.root ?? process.cwd()))
	const outDir = String(ctx.opts.out ?? join(root, 'snapshot'))
	const { loadConfig } = await import('../gen/config.js')
	const cfg = (await loadConfig(root)) as { outDir: string; distDir: string; target: string }
	const genEntries = join(root, cfg.outDir, 'entries.json')
	if (!existsSync(genEntries)) {
		throw new Error(`no ${cfg.outDir}/entries.json - run 'swelte build' first`)
	}
	mkdirSync(outDir, { recursive: true })
	copyFileSync(genEntries, join(outDir, 'entries.json'))
	// Rendered pages: every additive dist/*.html the prerender pass wrote.
	const distAbs = join(root, cfg.distDir)
	const pages: string[] = []
	const walk = (dir: string) => {
		let ents: { name: string }[] = []
		try {
			ents = readdirSync(dir, { withFileTypes: true }) as { name: string }[]
		} catch {
			return
		}
		for (const e of ents as unknown as { name: string; isDirectory(): boolean }[]) {
			const q = join(dir, e.name)
			if (e.isDirectory()) {
				walk(q)
				continue
			}
			if (e.name.endsWith('.html')) pages.push(q)
		}
	}
	walk(distAbs)
	for (const p of pages) {
		const rel = p.slice(distAbs.length + 1)
		const dest = join(outDir, 'pages', rel)
		mkdirSync(join(dest, '..'), { recursive: true })
		copyFileSync(p, dest)
	}
	// Contract snapshot (drift detection input).
	const contract = join(root, 'swelte.contract.json')
	if (existsSync(contract)) copyFileSync(contract, join(outDir, 'swelte.contract.json'))
	const summary = {
		version: 1,
		target: cfg.target,
		pages: pages.map((p) => p.slice(distAbs.length + 1)).sort(),
		at: new Date().toISOString(),
	}
	writeFileSync(join(outDir, 'snapshot.json'), JSON.stringify(summary, null, 2))
	ctx.log(`snapshot: ${pages.length} pages -> ${outDir}`)
}

export function snapshotPages(root: string, distDir: string): string[] {
	const out: string[] = []
	try {
		const walk = (dir: string) => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const q = join(dir, e.name)
				if (e.isDirectory()) {
					walk(q)
					continue
				}
				if (e.name.endsWith('.html')) {
					try {
						if (statSync(q).isFile()) out.push(q.slice(join(root, distDir).length + 1))
					} catch {
						/* ignore */
					}
				}
			}
		}
		walk(join(root, distDir))
	} catch {
		/* no dist */
	}
	return out.sort()
}

export function readContractIfExists(root: string): string | null {
	try {
		const p = join(root, 'swelte.contract.json')
		if (!existsSync(p)) return null
		return readFileSync(p, 'utf8')
	} catch {
		return null
	}
}
