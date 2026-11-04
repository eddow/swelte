// Prerender/SSG crawl (docs (built) item 3): additive `dist/*.html`
// only. Reads `.swelte/entries.json` (the crawl source — see
// `collectPrerenderEntries` in vite.ts), boots the built binary on an
// ephemeral port with `SWELTE_DIST=dist`, and GETs each crawl URL with
// browser Accept. 200 HTML responses are written to
// `dist/<route>/index.html` (root `/` keeps the `dist/index.html` shell —
// never overwritten with prerendered bytes; the shell stays the SPA
// fallback). JSON probes and error pages are skipped, never written.
// ISR lite: `isr` path-prefix map stamps `Cache-Control:
// public, max-age=0, s-maxage=N` + `X-Swelte-Revalidate: <seconds>` into
// the in-memory header table — headers only, no background revalidation,
// runtime default unchanged.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { freePortUnix, killPort, takePort, waitPort } from './dev.js'

interface CrawlFile {
	mode: string
	routes: string[]
	dynamics: string[]
	expanded: string[]
}

export interface PrerenderHooks {
	log: (m: string) => void
	onIsrHeaders?: (headers: Record<string, string>) => void
}

function crawlUrls(crawl: CrawlFile): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const u of [...(crawl.routes ?? []), ...(crawl.expanded ?? [])]) {
		if (typeof u !== 'string' || u === '' || seen.has(u)) continue
		seen.add(u)
		out.push(u)
	}
	return out.sort()
}

function distRelPath(url: string): string | null {
	if (url === '/') return null
	const clean = url.split('?')[0].split('#')[0]
	if (clean === '' || clean === '/') return null
	const rel = clean.replace(/^\/+/, '').replace(/\/+$/, '')
	if (rel === '' || rel.includes('..') || rel.includes('\0')) return null
	return join(rel, 'index.html')
}

function isrSecondsFor(url: string, isr: Record<string, number>): number | null {
	let best: number | null = null
	let bestLen = -1
	for (const [prefix, seconds] of Object.entries(isr)) {
		if (typeof prefix !== 'string' || prefix === '') continue
		const p = prefix === '/' ? '/' : `/${prefix.replace(/^\/+/, '').replace(/\/+$/, '')}`
		const hit = p === '/' ? true : url === p || url.startsWith(p.endsWith('/') ? p : `${p}/`)
		if (hit && p.length > bestLen) {
			bestLen = p.length
			best = seconds
		}
	}
	return best
}

export async function runPrerender(
	root: string,
	binary: string,
	cfg: Record<string, unknown>,
	hooks: PrerenderHooks
): Promise<{ pages: string[]; isrHeaders: Record<string, string> }> {
	const empty = { pages: [], isrHeaders: {} as Record<string, string> }
	// Global mode gates the bulk crawl — but per-page flags (`export const
	// prerender = true | 'auto'`) carry their own include even under
	// 'off' (leaf > wrapper > global; `false` excludes even under cover).
	// entries.json only lists what generate() resolved, so when global is
	// off we still crawl the explicitly-flagged subset.
	const genEntries = join(resolve(root), String(cfg['outDir'] ?? '.swelte'), 'entries.json')
	let crawl: CrawlFile
	try {
		crawl = JSON.parse(readFileSync(genEntries, 'utf8')) as CrawlFile
	} catch {
		return empty
	}
	const urls = crawlUrls(crawl)
	if (urls.length === 0) return empty
	const prerenderCfg = cfg['prerender'] as { concurrency?: unknown } | undefined
	const rawConc = prerenderCfg?.concurrency
	const conc =
		typeof rawConc === 'number' && Number.isFinite(rawConc) && rawConc > 0 ? Math.floor(rawConc) : 4
	const distDir = String(cfg['distDir'] ?? 'dist')
	const isr = (cfg['isr'] ?? {}) as Record<string, number>
	const probePort = takePort(0, 4191)
	await killPort(probePort, () => {})
	const child: ChildProcess = spawn(binary, [], {
		cwd: root,
		// SSR on: the crawl needs real HTML (dispatch-only JSON 200s are
		// skipped). The QJS bridge is embedded in the built binary, so
		// SWELTE_SSR=1 needs no sidecar.
		env: { ...process.env, PORT: String(probePort), SWELTE_DIST: distDir, SWELTE_SSR: '1' },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	try {
		if (!(await waitPort(probePort, 15000)))
			throw new Error(`prerender binary did not listen on :${probePort} within 15s`)
		const pages: string[] = []
		const isrHeaders: Record<string, string> = {}
		const queue = [...urls]
		const runOne = async (url: string): Promise<void> => {
			let res: Response
			try {
				res = await fetch(`http://127.0.0.1:${probePort}${url}`, {
					headers: { accept: 'text/html,application/xhtml+xml' },
				})
			} catch {
				return
			}
			const ct = (res.headers.get('content-type') ?? '').toLowerCase()
			if (res.status !== 200 || !(ct.includes('text/html') || ct === '')) return
			const html = await res.text()
			if (!html.includes('<html') && !html.includes('<!doctype')) return
			const rel = distRelPath(url)
			if (!rel) return
			const dest = join(resolve(root), distDir, rel)
			mkdirSync(join(dest, '..'), { recursive: true })
			writeFileSync(dest, html)
			pages.push(rel)
			const seconds = isrSecondsFor(url, isr)
			if (seconds !== null && seconds > 0) isrHeaders[url] = String(seconds)
		}
		const workers: Promise<void>[] = []
		for (let i = 0; i < Math.min(conc, queue.length); i++) {
			workers.push(
				(async () => {
					for (;;) {
						const next = queue.shift()
						if (next === undefined) return
						await runOne(next)
					}
				})()
			)
		}
		await Promise.all(workers)
		pages.sort()
		hooks.onIsrHeaders?.(isrHeaders)
		if (pages.length > 0) hooks.log(`prerender: ${pages.length} pages (+dist/*.html)`)
		const offline = cfg['offline'] as { fallback?: unknown } | undefined
		const fallback = typeof offline?.fallback === 'string' ? offline.fallback : 'off'
		if (fallback !== 'off' && pages.length > 0) {
			const dest = join(resolve(root), distDir, fallback)
			try {
				if (!existsSync(dest)) {
					writeFileSync(dest, readFileSync(join(resolve(root), distDir, pages[0]), 'utf8'))
					hooks.log(`offline: dist/${fallback}`)
				}
			} catch {
				/* best-effort */
			}
		}
		return { pages, isrHeaders }
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
		await killPort(probePort, () => {})
		try {
			await freePortUnix(probePort)
		} catch {
			/* ignore */
		}
	}
}
