import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dynSegPattern } from './matchers.js'
import type { SvelteRouteEntry } from './types.js'
import type { RouteLimits } from './types.js'

export function listFilesWithExt(dir: string, ext: string, base?: string): string[] {
	if (!existsSync(dir)) return []
	const root = base ?? dir
	const out: string[] = []
	// Sorted (byte order): readdir order is filesystem-dependent and made
	// routeGen flip between runs (§7). Deterministic order, always.
	for (const e of readdirSync(dir).sort()) {
		const p = join(dir, e)
		const st = statSync(p)
		// Never scan our own output (`.swelte/`) — never the input tree
		// (`src/routes/` lives under `src/`).
		if (st.isDirectory()) {
			if (e === '.swelte') continue
			out.push(...listFilesWithExt(p, ext, root))
		} else if (e.endsWith(ext)) out.push(p)
	}
	return out
}

export function listVFiles(dir: string, base?: string): string[] {
	return listFilesWithExt(dir, '.v', base)
}

export function svelteModKind(mod: string): 'page' | 'wrapper' | 'error' | 'plain' | null {
	const base = mod.includes('/') ? mod.slice(mod.lastIndexOf('/') + 1) : mod
	if (base === '+page' || base === 'index') return 'page'
	if (base === '+route') return 'wrapper'
	if (base === '+error') return 'error'
	if (base.startsWith('+')) return null
	return 'plain'
}

/** Route groups `(name)` — disk-only folders that contribute no URL segment.
 * `(admin)/users` -> `/users`. Syntactic only: a whole segment wrapped in
 * parens. Dynamics, `+page`, `+route` pass through untouched. */
export function stripRouteGroups(mod: string): string {
	return mod
		.split('/')
		.filter((seg) => seg !== '' && !/^\([^/]+\)$/.test(seg))
		.join('/')
}

/** URL pattern for a `.svelte` mod (mirrors routeFor leaf/dir rules).
 * Returns null for wrappers (+route) and unknown +-files. */
export function svelteRouteFor(mod: string): string | null {
	const kind = svelteModKind(mod)
	if (kind === null || kind === 'wrapper' || kind === 'error') return null
	if (kind === 'page') {
		const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
		const stripped = stripRouteGroups(dir)
		// A page that lives ONLY inside groups (`(mkt)/+page`) is `/` — same
		// folder-root rule as `+page` (folder-root claims the parent URL).
		if (stripped === '' && dir !== '') return '/'
		return stripped === '' || stripped === 'api' ? '/' : `/${stripped}`
	}
	return `/${stripRouteGroups(mod)}`
}

/** SSR manifest entry: route → svelte file + data pairing.
 * Engine-agnostic JSON — SSR adapters consume it; core
 * never imports svelte/compiler, quickjs, or a JS runtime. */
export function relPosixTop(abs: string, f: string): string {
	return f
		.slice(abs.length + 1)
		.split(sep)
		.join('/')
}

/** Classify a sibling universal-load (`.ts` preferred, `.js` accepted):
 * `false` (absent or no `load` export), `'sync'` (SSR-applied), `'async'`
 * (`export const ssr = false`, client-only). Core reads the sibling source
 * plus the `export const ssr` marker by regex — engine-agnostic;
 * ssr-qjs owns the sync-subset build errors. */
/** Resolve the sibling universal-load source: `<basename>.ts` preferred,
 * `<basename>.js` accepted (plain-JS sibling: raw-bundled into sync
 * render.js with no TS transform, and skipped by user `tsc --strict`). */
export function siblingLoadSource(tsAbs: string): string | null {
	if (existsSync(tsAbs)) return tsAbs
	const jsAbs = tsAbs.replace(/\.ts$/, '.js')
	if (jsAbs !== tsAbs && existsSync(jsAbs)) return jsAbs
	return null
}

export function universalLoadKind(tsAbs: string): 'sync' | 'async' | false {
	const found = siblingLoadSource(tsAbs)
	if (!found) return false
	let src = ''
	try {
		src = readFileSync(found, 'utf8')
	} catch {
		return false
	}
	if (!/\bexport\s+(async\s+)?function\s+load\b|\bexport\s+const\s+load\b/.test(src)) return false
	const m = /export\s+const\s+ssr\s*=\s*(true|false)/.exec(src)
	if (m && m[1] === 'false') return 'async'
	return 'sync'
}

/** Per-route chunk hint: `export const chunk = 'eager' | 'lazy'` in the
 * sibling `.ts` (leaf like `admin.ts` or wrapper like `+route.ts`).
 * Absent/no match = `'inherit'` (follow the global `chunking` mode).
 * Quoted-but-unknown value passes through here — `assertChunkHint`
 * turns it into a file+line build error at the call site. */
export function readChunkHint(src: string): 'eager' | 'lazy' | 'inherit' | string {
	const m = /export\s+const\s+chunk\s*=\s*['"]([^'"]+)['"]/.exec(src)
	if (!m) return 'inherit'
	return m[1]
}

/** Validate a chunk hint at the call site (file+line build error). */
export function assertChunkHint(file: string, src: string): 'eager' | 'lazy' | 'inherit' {
	const hint = readChunkHint(src)
	if (hint !== 'eager' && hint !== 'lazy' && hint !== 'inherit') {
		throw new Error(
			`[swelte] ${file}: bad chunk hint '${hint}' (want 'eager' | 'lazy' | 'inherit')`
		)
	}
	return hint
}

/** Per-route prerender flag: `export const prerender = true | false | 'auto'`
 * in the sibling `.ts` (leaf like `about.ts` or wrapper like `+route.ts`).
 * Absent/no match = `'inherit'` (follow the global `prerender.entries`).
 * Sibling `.ts` is the only knob carrier — `.v`-only routes use the global
 * mode. Boolean `false` excludes the route from the crawl even when the
 * global mode covers it; `true` includes it even under `entries: 'off'`;
 * `'auto'` = include + keep dynamic dispatch (manifest keeps all routes,
 * so `auto` === `true` for the crawl — resolved by callers). */
export function readPrerenderHint(
	src: string
): 'prerender-true' | 'prerender-false' | 'prerender-auto' | 'inherit' | string {
	if (/export\s+const\s+prerender\s*=\s*true\b/.test(src)) return 'prerender-true'
	if (/export\s+const\s+prerender\s*=\s*false\b/.test(src)) return 'prerender-false'
	const m = /export\s+const\s+prerender\s*=\s*['"]([^'"]+)['"]/.exec(src)
	if (!m) return 'inherit'
	return `prerender-${m[1]}`
}

/** Validate a prerender hint at the call site (file+line build error). */
export function assertPrerenderHint(
	file: string,
	src: string
): 'prerender-true' | 'prerender-false' | 'prerender-auto' | 'inherit' {
	const hint = readPrerenderHint(src)
	if (
		hint !== 'prerender-true' &&
		hint !== 'prerender-false' &&
		hint !== 'prerender-auto' &&
		hint !== 'inherit'
	) {
		throw new Error(
			`[swelte] ${file}: bad prerender hint '${hint.replace(/^prerender-/, '')}' (want true | false | 'auto')`
		)
	}
	return hint
}

/** Read a sibling `.ts`/`.js` file, return null on miss. */
export function siblingSrc(tsAbs: string): { src: string; file: string } | null {
	const found = siblingLoadSource(tsAbs)
	if (!found) return null
	try {
		return { src: readFileSync(found, 'utf8'), file: found }
	} catch {
		return { src: '', file: found }
	}
}

/** Per-route SSR flag from a sibling source: `export const ssr = false` opts out. */
export function readSsrFlag(src: string): boolean {
	return !/export\s+const\s+ssr\s*=\s*false/.test(src)
}

/** Per-route csr flag: `export const csr = false` renders SSR HTML only
 * (no client JS mount/hydrate for that leaf). Default `true`. */
export function readCsrFlag(src: string): boolean {
	return !/export\s+const\s+csr\s*=\s*false/.test(src)
}

/** Match `export const layout = <value>` (optional `: T` annotation
 * tolerated, like `assertSerializedHeadersHint`). Returns the whole match
 * plus value region for file+line errors. */
function layoutDecl(src: string): { rhs: string; index: number } | null {
	// Value must sit on the same line as the declaration (hint readers are
	// single-line by design). The type annotation form (`: T =`) is
	// tolerated like `serializedHeaders` — `rhs` still carries just the
	// value; a `|` union marker can only appear inside the annotation
	// because a bare value never contains one.
	const m = /export\s+const\s+layout\s*(?::\s*[^=;\n]+?)?=\s*([^\n;]+)/.exec(src)
	if (!m) return null
	return { rhs: m[1].trim(), index: m.index }
}

/** Per-route layout composition: `export const layout = false | true |
 * 'dir'` in the sibling `.ts` (leaf or `+route.ts` wrapper). `false` =
 * bare (no wrappers), `true` = explicit full chain, `'dir'` = keep
 * wrappers at-or-above that ancestor dir. Absent/no match = `null`
 * (inherit: keep walking up in `resolveLayoutHint`).
 * Quoted-but-unknown value passes through here — `assertLayoutHint`
 * turns it into a file+line build error at the call site. */
export function readLayoutHint(src: string): false | true | string | null {
	const decl = layoutDecl(src)
	if (!decl) return null
	if (decl.rhs === 'false') return false
	if (decl.rhs === 'true') return true
	const m = /^['"]([^'"]*)['"]$/.exec(decl.rhs)
	if (!m) return decl.rhs
	return m[1]
}

/** Validate a layout hint at the call site (file+line build error). Empty
 * string, unquoted non-boolean values, and paths that escape the leaf's
 * ancestry are rejected here; a quoted dir that is not an ancestor wrapper
 * dir is rejected by `resolveLayoutHint` (which knows the chain). */
export function assertLayoutHint(file: string, src: string): false | true | string | null {
	const decl = layoutDecl(src)
	if (!decl) return null
	const line = lineOf(src, decl.index)
	const msg = `[swelte] ${file}:${line}: bad layout hint '${decl.rhs}' (want false | true | 'ancestor-dir', e.g. export const layout = false or export const layout = 'admin').`
	if (decl.rhs === 'false') return false
	if (decl.rhs === 'true') return true
	// Only complete quoted strings reach the dir check — unquoted garbage
	// (`123`, `someVar`, unbalanced quotes) is a hint error, not a cut.
	// Leading/trailing `/` keep their error too (cuts are dirs, not paths).
	const m = /^['"]([^'"]+)['"]$/.exec(decl.rhs)
	if (m === null) {
		throw new Error(msg)
	}
	const cut = m[1].normalize('NFC')
	// Dots move (`..`) or hide (`.hidden`); groups/dynamics (`(a)`,
	// `[id]`) are separate routing features. Cuts stay plain single-path
	// dirs so a plain string compare against ancestor wrapper dirs is exact.
	if (
		cut.includes('.') ||
		cut.includes('(') ||
		cut.includes('[') ||
		!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(cut)
	) {
		throw new Error(msg)
	}
	return cut
}

/** Resolve the layout composition for one leaf entry: the leaf sibling
 * `.ts` wins, else the nearest wrapper `+route.ts` with an explicit hint
 * (starting at the leaf's OWN dir, walking up — mirrors the
 * `serializedHeaders` walk). `ancestors` = raw ancestor dirs that own a
 * wrapper (same basis as `chainFor`, unstripped). A named cut that is not
 * an ancestor wrapper dir is a file+line build error naming the file that
 * set it. `null` = inherit (no hint anywhere → full chain). */
export function resolveLayoutHint(
	routesDir: string,
	routesAbs: string,
	route: string,
	leafSib: { src: string; file: string } | null,
	ancestors: string[]
): false | true | string | null {
	const tag = (abs: string): string => `${routesDir}/${relPosixTop(routesAbs, abs)}`
	if (leafSib) {
		const hint = assertLayoutHint(tag(leafSib.file), leafSib.src)
		if (hint !== null) {
			if (typeof hint === 'boolean' || ancestors.includes(hint)) return hint
			throw new Error(
				`[swelte] ${tag(leafSib.file)}: bad layout cut '${hint}' — no ancestor wrapper at that dir (chain for ${route}: ${ancestors.length ? ancestors.map((a) => (a === '' ? '<root>' : a)).join(', ') : 'bare (no +route.svelte above)'}).`
			)
		}
	}
	const segs = route === '/' ? [] : route.split('/').filter(Boolean)
	for (let i = segs.length; i >= 0; i--) {
		const dir = segs.slice(0, i).join('/')
		const cand = dir === '' ? `${routesAbs}/+route.ts` : `${routesAbs}/${dir}/+route.ts`
		const hit = siblingSrc(cand)
		if (!hit) continue
		const hint = assertLayoutHint(tag(hit.file), hit.src)
		if (hint === null) continue
		if (typeof hint === 'boolean' || ancestors.includes(hint)) return hint
		throw new Error(
			`[swelte] ${tag(hit.file)}: bad layout cut '${hint}' — no ancestor wrapper at that dir (chain for ${route}: ${ancestors.length ? ancestors.map((a) => (a === '' ? '<root>' : a)).join(', ') : 'bare (no +route.svelte above)'}).`
		)
	}
	return null
}

function lineOf(src: string, idx: number): number {
	return src.slice(0, idx).split('\n').length
}

export function assertLimitsHint(file: string, src: string): RouteLimits | null {
	const m = /export\s+const\s+limits\s*=\s*\{([^}]*)\}/.exec(src)
	if (!m) return null
	const line = lineOf(src, m.index)
	const body = m[1]
	const out: RouteLimits = {}
	const allow: Record<string, keyof RouteLimits> = {
		rate: 'rate',
		rateWindowMs: 'rateWindowMs',
		timeoutMs: 'timeoutMs',
		timeout: 'timeoutMs',
		bodyLimit: 'bodyLimit',
	}
	for (const part of body.split(',')) {
		const t = part.trim()
		if (t === '') continue
		const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([0-9]+)$/.exec(t)
		if (!kv || !(kv[1] in allow)) {
			throw new Error(
				`[swelte] ${file}:${line}: bad limits hint — want e.g. export const limits = { rate: 10, rateWindowMs: 60000, timeoutMs: 5000, bodyLimit: 1048576 } (keys rate|rateWindowMs|timeoutMs|bodyLimit, positive ints).`
			)
		}
		const v = parseInt(kv[2], 10)
		if (!Number.isFinite(v) || v <= 0) {
			throw new Error(
				`[swelte] ${file}:${line}: bad limits hint — '${kv[1]}' must be a positive int.`
			)
		}
		out[allow[kv[1]]] = v
	}
	return out
}
/** Per-route serialized-headers allowlist (SvelteKit
 *  `filterSerializedResponseHeaders` lite): `export const
 *  serializedHeaders = ['x-foo', ...]` in the sibling `.ts` (leaf or
 *  `+route.ts` wrapper). Null = absent (no filter — today's behavior:
 *  all load-envelope headers land on the HTML navigation). An explicit
 *  list (incl. `[]`) keeps only those names (exact match,
 *  case-insensitive at runtime). Bad shape = file+line build error. */
export function assertSerializedHeadersHint(file: string, src: string): string[] | null {
	const m = /export\s+const\s+serializedHeaders\s*(?::[^=]*)?=\s*\[([^\]]*)\]/.exec(src)
	if (!m) {
		// Declared but unparseable — includes the typed form
		// (`serializedHeaders: string[] = ...`), so a typed declaration
		// never silently falls back to "no filter" (fail-open).
		if (/export\s+const\s+serializedHeaders\s*(?::[^=]*)?=/.test(src)) {
			const line = lineOf(src, src.search(/export\s+const\s+serializedHeaders\s*(?::[^=]*)?=/))
			throw new Error(
				`[swelte] ${file}:${line}: bad serializedHeaders hint — want e.g. export const serializedHeaders = ['x-foo', 'x-bar'] (quoted header names, letters/digits/dashes).`
			)
		}
		return null
	}
	const line = lineOf(src, m.index)
	const out: string[] = []
	for (const part of m[1].split(',')) {
		const trim = part.trim()
		if (trim === '') continue
		const mm = /^['"]([^'"]+)['"]$/.exec(trim)
		if (!mm || !/^[A-Za-z0-9-]+$/.test(mm[1])) {
			throw new Error(
				`[swelte] ${file}:${line}: bad serializedHeaders hint — want e.g. export const serializedHeaders = ['x-foo', 'x-bar'] (quoted header names, letters/digits/dashes).`
			)
		}
		out.push(mm[1])
	}
	return out
}

/** Partition a crawl pattern list by per-page flags: `false` always drops
 * (even under global cover); `true`/`'auto'` includes even under 'off';
 * `inherit` follows the global mode. `flags` maps pattern → explicit flag
 * (leaf > wrapper already resolved); dropped dynamics never expand. */
export function partitionPrerender(
	patterns: string[],
	flags: Map<string, 'prerender-true' | 'prerender-false' | 'prerender-auto'>,
	mode: 'off' | 'static' | 'all'
): { routes: string[]; dynamics: string[] } {
	const routes: string[] = []
	const dynamics: string[] = []
	for (const p of patterns) {
		const flag = flags.get(p)
		if (flag === 'prerender-false') continue
		if (flag === 'prerender-true' || flag === 'prerender-auto') {
			;(isStaticRoute(p) ? routes : dynamics).push(p)
			continue
		}
		if (mode === 'off') continue
		;(isStaticRoute(p) ? routes : dynamics).push(p)
	}
	return { routes, dynamics }
}

/** Collect `.svelte` siblings under routesAbs into a URL manifest.
 * Dynamic segments pass through verbatim ([id]/[...rest]). */
export function collectSvelteManifest(
	routesAbs: string,
	routesDir: string,
	vMods: Set<string>
): { entries: SvelteRouteEntry[]; hasError: boolean } {
	const entries: SvelteRouteEntry[] = []
	let hasError = false
	let files: string[] = []
	try {
		files = listFilesWithExt(routesAbs, '.svelte')
	} catch {
		return { entries, hasError }
	}
	for (const f of files.sort()) {
		const rel = relPosixTop(routesAbs, f)
		const mod = rel.replace(/\.svelte$/, '')
		// Layout reset moved to `export const layout` (sibling `.ts`):
		// an `@` stem no longer means anything, and `+page@`/`about@`
		// silently became a different URL — fail loud with the fix.
		const stem = mod.includes('/') ? mod.slice(mod.lastIndexOf('/') + 1) : mod
		if (stem.includes('@')) {
			throw new Error(
				`[swelte] ${routesDir}/${rel}: layout reset moved to \`export const layout\` — rename to ${routesDir}/${mod.replace(/@.*$/, '')}.svelte and set it in the sibling .ts (export const layout = false | true | 'ancestor-dir').`
			)
		}
		const kind = svelteModKind(mod)
		if (kind === null) continue
		if (kind === 'error') {
			const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
			if (dir !== '') {
				throw new Error(
					`[swelte] ${routesDir}/${rel} is not allowed — only src/routes/+error.svelte exists (single global error boundary, no per-directory inheritance).`
				)
			}
			hasError = true
			entries.push({
				route: '/+error',
				svelte: rel,
				kind: 'error',
				hasData: false,
				hasUniversalLoad: false,
				ssr: true,
				csr: true,
				limits: null,
				chunk: 'inherit',
				prerender: 'inherit',
				serializedHeaders: null,
				layout: null,
			})
			continue
		}
		if (kind === 'wrapper') {
			const sib = siblingSrc(f.replace(/\.svelte$/, '.ts'))
			entries.push({
				route: svelteRouteFor(mod) ?? `/${mod}`,
				svelte: rel,
				kind: 'wrapper',
				hasData: vMods.has(mod),
				hasUniversalLoad: universalLoadKind(f.replace(/\.svelte$/, '.ts')),
				ssr: sib ? readSsrFlag(sib.src) : true,
				csr: sib ? readCsrFlag(sib.src) : true,
				limits: sib
					? assertLimitsHint(`${routesDir}/${relPosixTop(routesAbs, sib.file)}`, sib.src)
					: null,
				chunk: sib
					? assertChunkHint(`${routesDir}/${relPosixTop(routesAbs, sib.file)}`, sib.src)
					: 'inherit',
				prerender: sib
					? assertPrerenderHint(`${routesDir}/${relPosixTop(routesAbs, sib.file)}`, sib.src)
					: 'inherit',
				serializedHeaders: sib
					? assertSerializedHeadersHint(`${routesDir}/${relPosixTop(routesAbs, sib.file)}`, sib.src)
					: null,
				layout: null,
			})
			continue
		}
		const route = svelteRouteFor(mod)
		if (route === null) continue
		// Static .svelte sibling (no .v) must carry no @[...] attrs:
		// it ships zero JS either way (pure static HTML/JS, no data channel).
		if (!vMods.has(mod)) {
			let src = ''
			try {
				src = readFileSync(f, 'utf8')
			} catch {
				src = ''
			}
			const badAttr = /@\[(get|post|put|delete|patch|rpc|sse|before|after)\b/.exec(src)
			if (badAttr) {
				throw new Error(
					`[swelte] ${routesDir}/${rel}: @[${badAttr[1]}] on a .svelte file with no .v partner does nothing — add ${routesDir}/${mod}.v or remove the attribute.`
				)
			}
		}
		entries.push({
			route,
			svelte: rel,
			kind: kind as 'page' | 'plain',
			// Wrapper layouts for the URL that a named cut resolves against
			// (raw ancestor dirs owning a wrapper — same rule as `chainFor`).
			// Only svelte entries scan for now; the wrapper set used by the
			// SSR manifest / routes.js filters identically.
			layout: resolveLayoutHint(
				routesDir,
				routesAbs,
				route,
				siblingSrc(f.replace(/\.svelte$/, '.ts')),
				(() => {
					const ancestors: string[] = []
					const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
					let cur = dir
					for (;;) {
						const cand =
							cur === '' ? `${routesAbs}/+route.svelte` : `${routesAbs}/${cur}/+route.svelte`
						if (existsSync(cand)) ancestors.push(cur)
						if (cur === '') break
						cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''
					}
					return ancestors
				})()
			),
			hasData: vMods.has(mod),
			hasUniversalLoad: universalLoadKind(f.replace(/\.svelte$/, '.ts')),
			ssr: (() => {
				const sib = siblingSrc(f.replace(/\.svelte$/, '.ts'))
				return sib ? readSsrFlag(sib.src) : true
			})(),
			csr: (() => {
				const sib = siblingSrc(f.replace(/\.svelte$/, '.ts'))
				return sib ? readCsrFlag(sib.src) : true
			})(),
			limits: (() => {
				const sib = siblingSrc(f.replace(/\.svelte$/, '.ts'))
				if (!sib) return null
				return assertLimitsHint(`${routesDir}/${relPosixTop(routesAbs, sib.file)}`, sib.src)
			})(),
			chunk: (() => {
				const sib = siblingSrc(f.replace(/\.svelte$/, '.ts'))
				if (!sib) return 'inherit' as const
				return assertChunkHint(`${routesDir}/${relPosixTop(routesAbs, sib.file)}`, sib.src)
			})(),
			prerender: (() => {
				const sib = siblingSrc(f.replace(/\.svelte$/, '.ts'))
				if (!sib) return 'inherit' as const
				return assertPrerenderHint(`${routesDir}/${relPosixTop(routesAbs, sib.file)}`, sib.src)
			})(),
			serializedHeaders: (() => {
				const sib = siblingSrc(f.replace(/\.svelte$/, '.ts'))
				if (sib) {
					const hint = assertSerializedHeadersHint(
						`${routesDir}/${relPosixTop(routesAbs, sib.file)}`,
						sib.src
					)
					if (hint) return hint
				}
				// Nearest wrapper +route.ts with an explicit hint, starting at
				// the leaf's OWN dir (same-dir `+route.svelte` wraps it) and
				// walking up — mirrors `flagForSvelte` in the prerender path.
				const segs = route === '/' ? [] : route.split('/').filter(Boolean)
				for (let i = segs.length; i >= 0; i--) {
					const dir = segs.slice(0, i).join('/')
					const cand = dir === '' ? `${routesAbs}/+route.ts` : `${routesAbs}/${dir}/+route.ts`
					const hit = siblingSrc(cand)
					if (hit) {
						const hint = assertSerializedHeadersHint(
							`${routesDir}/${relPosixTop(routesAbs, hit.file)}`,
							hit.src
						)
						if (hint) return hint
					}
				}
				return null
			})(),
		})
	}
	return { entries, hasError }
}

export interface PrerenderCrawl {
	mode: 'off' | 'static' | 'all'
	routes: string[]
	/** Dynamics that need sibling `entries` expansion (`entries: 'all'`). */
	dynamics: string[]
	/** Resolved dynamic URLs (only when `mode: 'all'`). */
	expanded: string[]
}

/** Static-route test: no `[param]`, `[...rest]`, or `[[optional]]`. */
export function isStaticRoute(route: string): boolean {
	return !route.includes('[')
}

/** Enumerate the prerender crawl list (docs (built) item 2).
 *  Static routes are always listed. `mode: 'all'` also executes sibling
 *  `entries.ts` exports (`export function entries()` — sync or async —
 *  returning string[] or `{ slug }[]`-ish) for dynamic segments; bad
 *  shape = build error with file+line. Async (incl. paginated fetch
 *  loops) is awaited at generate time. No prerender implied - just the
 *  route list for crawl. */
export async function collectPrerenderEntries(
	root: string,
	routesDir: string,
	mode: 'off' | 'static' | 'all',
	knownMatchers?: Set<string>
): Promise<PrerenderCrawl> {
	const routesAbs = join(resolve(root), routesDir)
	let patterns: string[] = []
	const flags = new Map<string, 'prerender-true' | 'prerender-false' | 'prerender-auto'>()
	try {
		const mods = new Set<string>()
		for (const f of listVFiles(routesAbs)) {
			const rel = relPosixTop(routesAbs, f).replace(/\.v$/, '')
			mods.add(rel)
		}
		const { entries } = collectSvelteManifest(routesAbs, routesDir, mods)
		const byRoute = new Map(entries.map((e) => [e.route, e]))
		const wrappers = entries.filter((e) => e.kind === 'wrapper')
		// Explicit per-page flag for a svelte pattern: leaf wins, else the
		// nearest ancestor `+route.ts` with an explicit flag, else inherit.
		const flagForSvelte = (
			route: string
		): 'prerender-true' | 'prerender-false' | 'prerender-auto' | null => {
			const leaf = byRoute.get(route)
			if (leaf && leaf.prerender !== 'inherit') return leaf.prerender
			const segs = route.split('/').filter(Boolean)
			for (let i = segs.length; i >= 0; i--) {
				const prefix = `/${segs.slice(0, i).join('/')}`
				const norm = prefix === '/' ? '/' : prefix
				for (const w of wrappers) {
					const wDir = w.svelte.replace(/\/\+route\.svelte$/, '').replace(/^\+route\.svelte$/, '')
					const wRoute = wDir === '' ? '/' : `/${wDir}`
					if (wRoute === norm && w.prerender !== 'inherit') return w.prerender
				}
			}
			return null
		}
		const seen = new Set<string>()
		for (const e of entries) {
			if (e.kind === 'wrapper' || e.kind === 'error') continue
			if (!seen.has(e.route)) {
				seen.add(e.route)
				patterns.push(e.route)
				const flag = flagForSvelte(e.route)
				if (flag) flags.set(e.route, flag)
			}
		}
		// V-only routes (no .svelte): routeFor leaf/dir rules (abs path form).
		// §7: pass the custom matcher set — bare `routeFor` without it treats
		// every `[x=y]` as `unknown matcher` (only `integer` builtin known).
		// Injected by the plugin (already loaded); absent = builtin only.
		for (const f of listVFiles(routesAbs)) {
			const r = routeFor(routesDir, routesAbs, f, knownMatchers)
			if (r && !seen.has(r)) {
				seen.add(r)
				patterns.push(r)
			}
		}
	} catch (e) {
		throw e
	}
	patterns.sort()
	const part = partitionPrerender(patterns, flags, mode)
	const out: PrerenderCrawl = { mode, routes: part.routes, dynamics: part.dynamics, expanded: [] }
	if (mode !== 'all') return out
	// Dynamic expansion: sibling `entries.ts` next to the dynamic leaf.
	// Accepted shapes: `string[]`, `{ slug: string }[]`-ish rows, or
	// `{ params: Record<string,string> }[]`. Anything else = build error.
	for (const pattern of part.dynamics) {
		const sibling = dynamicEntriesSibling(routesAbs, pattern)
		if (!sibling) continue
		let mod: Record<string, unknown>
		try {
			mod = (await import(`${pathToFileURL(sibling).href}?t=${Date.now()}`)) as Record<
				string,
				unknown
			>
		} catch (e) {
			throw new Error(
				`[swelte] ${relative(resolve(root), sibling)}: entries() import failed - ${(e as Error).message}`
			)
		}
		const fn = mod['entries']
		if (typeof fn !== 'function') {
			throw new Error(
				`[swelte] ${relative(resolve(root), sibling)}: no \`export function entries()\` - dynamics need it when prerender.entries is 'all'.`
			)
		}
		let rows: unknown
		try {
			rows = await (fn as () => unknown)()
		} catch (e) {
			throw new Error(
				`[swelte] ${relative(resolve(root), sibling)}: entries() threw - ${(e as Error).message}`
			)
		}
		if (!Array.isArray(rows)) {
			throw new Error(
				`[swelte] ${relative(resolve(root), sibling)}: entries() must return an array (got ${typeof rows}) — sync or async (awaited at generate time).`
			)
		}
		for (const row of rows) {
			out.expanded.push(expandDynamicPattern(pattern, row, relative(resolve(root), sibling)))
		}
	}
	out.expanded.sort()
	return out
}

/** Locate the sibling `entries.ts` for a dynamic pattern: strip groups,
 *  map segments back to disk names (`[id]` literal dir). */
export function dynamicEntriesSibling(routesAbs: string, pattern: string): string | null {
	const segs = pattern.split('/').filter(Boolean)
	const disk = segs.map((s) => s)
	const candTs = join(routesAbs, ...disk, 'entries.ts')
	if (existsSync(candTs)) return candTs
	const candJs = join(routesAbs, ...disk, 'entries.js')
	if (existsSync(candJs)) return candJs
	return null
}

export function expandDynamicPattern(pattern: string, row: unknown, file: string): string {
	const fail = (why: string): never => {
		throw new Error(`[swelte] ${file}: entries() row ${JSON.stringify(row)} ${why}.`)
	}
	let params: Record<string, string>
	if (typeof row === 'string') {
		const names = [
			...pattern.matchAll(/\[\.\.\.(\w+)\]|`\[\[(\w+)\]\]`|\[(\w+)(?:=[^\]]+)?\]/g),
		].map((m) => m[1] ?? m[2] ?? m[3])
		if (names.length === 1) params = { [names[0]]: row }
		else fail(`must be an object when the pattern has ${names.length} params`)
		params = params!
	} else if (row && typeof row === 'object' && !Array.isArray(row)) {
		const r = row as Record<string, unknown>
		const inner = r['params']
		const src =
			inner && typeof inner === 'object' && !Array.isArray(inner)
				? (inner as Record<string, unknown>)
				: r
		params = {}
		for (const [k, v] of Object.entries(src)) {
			if (typeof v !== 'string' && typeof v !== 'number') fail(`param '${k}' must be string/number`)
			params[k] = String(v)
		}
	} else {
		fail('must be a string or params object')
		params = {}
	}
	let url = pattern
	url = url.replace(/\[\.\.\.(\w+)\]/g, (_, n: string) => {
		const v = params[n]
		if (v === undefined) fail(`missing param '${n}'`)
		return v
	})
	url = url.replace(/\[\[(\w+)\]\]/g, (_, n: string) => params[n] ?? '')
	url = url.replace(/\[(\w+)(?:=[^\]]+)?\]/g, (_, n: string) => {
		const v = params[n]
		if (v === undefined) fail(`missing param '${n}'`)
		return v
	})
	if (url.includes('[')) fail(`unresolved pattern '${url}'`)
	return url === '' ? '/' : url.startsWith('/') ? url : `/${url}`
}

export function modulePath(root: string, file: string): string {
	return relative(root, file).replace(/\.v$/, '').split(sep).join('/')
}

/** Client chunk key for a svelte entry under a `chunking` mode.
 *  `single` → `'app'` (static imports, one chunk).
 *  `route` → one chunk per leaf (`eager` leaf joins its layout chunk).
 *  `layout` → nearest ancestor dir (self included) containing a
 *  `+route.svelte` wrapper (folder without a wrapper bubbles up; `root`
 *  when none). An explicit `'lazy'` wrapper/page forces a cut at its own
 *  dir; `'eager'` collapses into the parent chunk.
 *  `wrapperMods` = set of mods (`admin/+route`) owning a wrapper. */
export function chunkKeyFor(
	mode: 'single' | 'layout' | 'route',
	entry: { svelte: string; kind: 'page' | 'plain' | 'error' | 'wrapper'; chunk?: string },
	wrapperMods: Set<string>
): string {
	const hint = entry.chunk ?? 'inherit'
	if (mode === 'single') {
		if (hint === 'lazy') return chunkKeySelf(entry)
		return 'app'
	}
	if (entry.kind === 'error') return 'app'
	if (mode === 'route') {
		if (hint === 'eager') return layoutChunkKey(entry, wrapperMods, false)
		return chunkKeySelf(entry)
	}
	// layout
	if (hint === 'lazy') return chunkKeySelf(entry)
	return layoutChunkKey(entry, wrapperMods, hint === 'eager' && entry.kind === 'wrapper')
}

/** Own-dir chunk key: parent layout still wraps at runtime, but the file
 *  ships in its own `import()` chunk. */
function chunkKeySelf(entry: { svelte: string }): string {
	const mod = entry.svelte.replace(/\.svelte$/, '')
	const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
	return `page:${dir === '' ? '/' : dir}`
}

/** Nearest ancestor dir (self included) with a `+route.svelte`.
 *  `skipSelf` (explicit `eager` on a wrapper) starts the walk at the
 *  parent dir. */
function layoutChunkKey(
	entry: { svelte: string },
	wrapperMods: Set<string>,
	skipSelf: boolean
): string {
	const mod = entry.svelte.replace(/\.svelte$/, '')
	let dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
	if (skipSelf) dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
	for (;;) {
		const wmod = dir === '' ? '+route' : `${dir}/+route`
		if (wrapperMods.has(wmod)) return `layout:${dir === '' ? '/' : dir}`
		if (dir === '') return 'layout:/'
		dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
	}
}

/** V dispatch prefix for a route mod (`admin/+page` → `swelte_admin__page_`). */
export function vPrefix(mod: string): string {
	return `swelte_${mod.replace(/[^A-Za-z0-9_]/g, '_')}_`
}

/** Filesystem-safe generated name for a route mod (`+page` → `_page`). */
export function vFileSafe(mod: string): string {
	return mod.replace(/[^A-Za-z0-9_]/g, '_')
}

/** Map a routes file to its URL path (spec v-imports.md §2).
 * Dynamic segments pass through verbatim (`users/[id]` →
 * `/users/[id]`); the V dispatcher matches them segment-wise
 * (roadmap §8); `[...rest]` at the END is a catch-all that may match
 * empty (`files/[...rest].v` → `/files/[...rest]`, `GET /files` gives
 * `rest=''`) and coexists with a folder-root leaf (`files/+page.v` →
 * `/files` wins on exact match — static beats dynamic). `+route` →
 * null (wrapper-only; handled above by callers).
 * Pure + exported: single source for `generate()`'s load path and tests. */
export function routeFor(
	routesDir: string,
	routesAbs: string,
	file: string,
	knownMatchers?: Set<string>
): string | null {
	const mod = modulePath(routesAbs, file)
	if (mod === '+route' || mod.endsWith('/+route')) {
		if (mod.includes('['))
			throw new Error(
				`[swelte] ${routesDir}/${relPosix(routesAbs, file)}: dynamic wrapper dirs are not supported (no brackets in +route.v paths)`
			)
		return null
	}
	const leaf =
		mod === 'index' || mod.endsWith('/index') || mod === '+page' || mod.endsWith('/+page')
	if (leaf) {
		// Folder-root leaf: strip the leaf segment (`+page` or legacy
		// `index`) to get the directory, whose path is the URL.
		// `+page` → `/`, `admin/+page` → `/admin`.
		// NOTE: `+page.v` sorting — `+` (0x2B) sorts before letters,
		// so `+page.v` may scan before `admin/`. Sort order of
		// listVFiles is deterministic; route identity never depends
		// on it (pure function of mod).
		const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
		const strippedDir = stripRouteGroups(dir)
		if (dir !== '')
			validateDynamicSegs(
				`${routesDir}/${relPosix(routesAbs, file)}`,
				strippedDir.split('/'),
				knownMatchers
			)
		if (strippedDir === '' && dir !== '') return '/'
		return strippedDir === '' || strippedDir === 'api' ? '/' : `/${strippedDir}`
	}
	const segs = stripRouteGroups(mod).split('/')
	validateDynamicSegs(`${routesDir}/${relPosix(routesAbs, file)}`, segs, knownMatchers)
	return `/${segs.join('/')}`
}

export function validateDynamicSegs(file: string, segs: string[], known?: Set<string>): void {
	const seen = new Set<string>()
	// Built-in param matchers: `[id=integer]` constrains the segment.
	// Custom matchers from `src/matchers.v` extend the set; unknown name =
	// build error (file+line at the call site).
	const KNOWN_MATCHERS = known ?? new Set(['integer'])
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i]
		if (!s.includes('[') && !s.includes(']')) continue
		const single = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(s)
		const optional = /^\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]$/.exec(s)
		const rest = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(s)
		const matched = /^\[([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(s)
		if (single) {
			if (seen.has(single[1]))
				throw new Error(`[swelte] ${file}: duplicate route param [${single[1]}]`)
			seen.add(single[1])
			continue
		}
		if (optional) {
			// `[[slug]]` matches zero-or-one segment; last-segment only
			// (same positional rule as the catch-all — unambiguous).
			if (i !== segs.length - 1)
				throw new Error(
					`[swelte] ${file}: [[${optional[1]}]] optional param must be the last segment`
				)
			if (seen.has(optional[1]))
				throw new Error(`[swelte] ${file}: duplicate route param [[${optional[1]}]]`)
			seen.add(optional[1])
			continue
		}
		if (rest) {
			if (i !== segs.length - 1)
				throw new Error(`[swelte] ${file}: [...${rest[1]}] catch-all must be the last segment`)
			if (seen.has(rest[1]))
				throw new Error(`[swelte] ${file}: duplicate route param [...${rest[1]}]`)
			seen.add(rest[1])
			continue
		}
		if (matched) {
			const [, name, matcher] = matched
			if (!KNOWN_MATCHERS.has(matcher))
				throw new Error(
					`[swelte] ${file}: unknown matcher '${matcher}' in [${name}=${matcher}] (known: ${[...KNOWN_MATCHERS].sort().join(', ')})`
				)
			if (seen.has(name)) throw new Error(`[swelte] ${file}: duplicate route param [${name}]`)
			seen.add(name)
			continue
		}
		throw new Error(
			`[swelte] ${file}: bad dynamic segment '${s}' (want [id], [id=integer], [[slug]], or [...rest])`
		)
	}
}

export function relPosix(abs: string, f: string): string {
	return relative(abs, f).split(sep).join('/')
}

/** Dynamic path params of a route pattern (`users/[id]` -> ['id']). */
export function routeParams(route: string): string[] {
	const out: string[] = []
	for (const m of route.matchAll(dynSegPatternGlobal())) out.push(m[1] ?? m[2] ?? m[3] ?? m[5])
	return out
}

/** Global-flag copy of dynSegPattern (matchAll needs /g; keeps one source). */
export function dynSegPatternGlobal(): RegExp {
	return new RegExp(dynSegPattern.source, 'g')
}

export function dynSegName(seg: string): string | null {
	const m =
		/^\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]$/.exec(seg) ??
		/^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg) ??
		/^\[([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg) ??
		/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg)
	if (!m) return null
	return m[1]
}

/** TS type of one route param (`integer` -> `number`, else `string`). */
export function routeParamTs(route: string, name: string): string {
	for (const seg of route.split('/')) {
		if (dynSegName(seg) === name) return dynSegMatcher(seg) === 'integer' ? 'number' : 'string'
	}
	return 'string'
}

/** Matcher of one dynamic segment text (`[id=integer]` -> `integer`, else null). */
export function dynSegMatcher(seg: string): string | null {
	const m = /^\[([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(seg)
	return m ? m[2] : null
}
