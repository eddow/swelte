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
import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve, sep } from 'node:path'
import { waitPort } from './dev.js'

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
	if (rel === '') return null
	try {
		const segments = rel.split('/').map(decodeURIComponent)
		if (segments.some((segment) => segment === '.' || segment === '..' || /[\\/\0]/.test(segment)))
			return null
		return join(...segments, 'index.html')
	} catch {
		return null
	}
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
	const distDir = String(cfg['distDir'] ?? 'dist')
	const dist = resolve(root, distDir)
	const generated = resolve(root, String(cfg['outDir'] ?? '.swelte'))
	const ownershipFile = join(generated, 'prerendered.json')
	const recordPages = (pages: string[]) => {
		let old: { dist?: string; pages?: string[] } = {}
		try {
			old = JSON.parse(readFileSync(ownershipFile, 'utf8'))
		} catch {
			/* first crawl */
		}
		if (old.dist === dist && Array.isArray(old.pages))
			for (const page of old.pages) {
				if (pages.includes(page) || typeof page !== 'string') continue
				const target = resolve(dist, page)
				if (target.startsWith(dist + sep) && page.endsWith(`${sep}index.html`))
					rmSync(target, { force: true })
			}
		mkdirSync(generated, { recursive: true })
		writeFileSync(ownershipFile, JSON.stringify({ dist, pages }, null, 2))
	}
	if (urls.length === 0) {
		recordPages([])
		return empty
	}
	const prerenderCfg = cfg['prerender'] as { concurrency?: unknown } | undefined
	const rawConc = prerenderCfg?.concurrency
	const conc =
		typeof rawConc === 'number' && Number.isFinite(rawConc) && rawConc > 0 ? Math.floor(rawConc) : 4
	const isr = (cfg['isr'] ?? {}) as Record<string, number>
	const probe = createServer()
	probe.listen(0, '127.0.0.1')
	await once(probe, 'listening')
	const probePort = (probe.address() as { port: number }).port
	await new Promise<void>((resolveClose, reject) =>
		probe.close((error) => (error ? reject(error) : resolveClose()))
	)
	const child: ChildProcess = spawn(binary, [], {
		cwd: root,
		// SSR on: the crawl needs real HTML (dispatch-only JSON 200s are
		// skipped). The QJS bridge is embedded in the built binary, so
		// SWELTE_SSR=1 needs no sidecar.
		env: {
			...process.env,
			PORT: String(probePort),
			SWELTE_DIST: distDir,
			SWELTE_SSR: '1',
			SWELTE_SSR_STRICT: '1',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	const exited = once(child, 'exit')
	void exited.catch(() => {})
	let childLog = ''
	for (const stream of [child.stdout, child.stderr])
		stream?.on('data', (bytes) => {
			childLog = (childLog + bytes).slice(-8000)
		})
	try {
		if (!(await waitPort(probePort, 15000)))
			throw new Error(`prerender binary did not listen on :${probePort} within 15s: ${childLog}`)
		const pages: string[] = []
		const isrHeaders: Record<string, string> = {}
		const queue = [...urls]
		const runOne = async (url: string): Promise<void> => {
			let res: Response
			try {
				res = await fetch(`http://127.0.0.1:${probePort}${url}`, {
					headers: { accept: 'text/html,application/xhtml+xml' },
					redirect: 'manual',
					signal: AbortSignal.timeout(15000),
				})
			} catch {
				hooks.log(`prerender: skipped ${url} (request failed)`)
				return
			}
			const ct = (res.headers.get('content-type') ?? '').toLowerCase()
			if (res.status !== 200 || !(ct.includes('text/html') || ct === '')) {
				hooks.log(`prerender: skipped ${url} (HTTP ${res.status}, ${ct || 'no content type'})`)
				return
			}
			const html = await res.text()
			if (!html.includes('<html') && !html.includes('<!doctype')) return
			if (html.includes('<!--ssr-body-->') || html.includes('data-swelte-render-error="1"')) {
				hooks.log(`prerender: skipped ${url} (unrendered shell or render error)`)
				return
			}
			const rel = distRelPath(url)
			if (!rel) return
			const dest = join(dist, rel)
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
		recordPages(pages)
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
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGTERM')
			const configured = Number(process.env.SWELTE_SHUTDOWN_TIMEOUT_MS)
			const budget = Number.isFinite(configured) && configured > 0 ? configured : 10000
			const timer = setTimeout(() => child.kill('SIGKILL'), budget + 500)
			try {
				await exited
			} finally {
				clearTimeout(timer)
			}
		}
	}
}
