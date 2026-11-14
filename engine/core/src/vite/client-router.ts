// Roadmap 7: client router — UI composition without manual imports.
// Emits `.swelte/routes.js`: real static imports of every page +
// wrapper, a ROUTES array (path pattern, page, wrappers root→leaf),
// and mountRoute() that matches location.pathname (static-first,
// fewest-params-first — same precedence as the V dispatcher) and
// nests the page inside its wrappers via `children` snippets.
// main.ts mounts through it; unknown path → +error.svelte 404.
//
// Pure by construction: everything the template needs arrives via
// `ClientRouterInput` (FS reads stay inside — same best-effort
// try/catch semantics as the inline version). The caller owns the
// disk writes (`routes.js`, `chunks.json`) via `writeIfChanged`.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	collectErrorBoundaries,
	errorBoundaryProps,
	selectErrorBoundaries,
} from './error-boundaries.js'
import { parseVFile } from './parse.js'
import { chunkKeyFor, collectSvelteManifest, modulePath } from './routes.js'
import type { MatcherDef, SvelteRouteEntry } from './types.js'

/** Everything `emitClientRouter` needs — all owned by `generate()`. */
export interface ClientRouterInput {
	/** Absolute path to `src/routes`. */
	routesAbs: string
	/** Routes dir as passed to the plugin (for the import prefix). */
	routesDir: string
	/** Dispatched V routes (leaf UI entries). */
	dispatched: { route: string; mod: string }[]
	/** All route `.v` files (for the `hasLoad` scan). */
	routeFiles: string[]
	/** Mods with a `.v` partner (svelte-only detection). */
	vMods: Set<string>
	/** Custom param matchers (for `__swelteMatcherFns`). */
	matchers: Map<string, MatcherDef>
	/** Global chunking mode (from config/env). */
	appChunking: 'single' | 'layout' | 'route'
}

/** `.swelte/routes.js` lines + the `chunks.json` payload (`null` when `single`). */
export interface ClientRouterOutput {
	lines: string[]
	chunks: { mode: string; chunks: Record<string, string[]> } | null
}

/**
 * Build the client-router module text + chunk map.
 *
 * Side-effect-free: returns lines for `routes.js` and the chunks payload
 * (the caller writes both via `writeIfChanged`).
 */
export function emitClientRouter(input: ClientRouterInput): ClientRouterOutput {
	const { routesAbs, routesDir, dispatched, routeFiles, vMods, matchers, appChunking } = input
	const svelteOnly: { route: string; mod: string; wrappers: string[] }[] = []
	let svelteEntriesForChunk: SvelteRouteEntry[] = []
	const layoutByMod = new Map<string, false | true | string>()
	const csrByMod = new Map<string, boolean>()
	// Layout composition (`export const layout` in the sibling `.ts`):
	// `false` mounts the page bare; `'dir'` keeps wrappers at-or-above the
	// named ancestor dir; `true`/absent keeps the full chain. Shared by
	// dispatched + svelte-only entries.
	const cutWrappers = (mod: string, wrappers: string[]): string[] => {
		const cut = layoutByMod.get(mod)
		if (cut === undefined || cut === null || cut === true) return wrappers
		if (cut === false) return []
		const dirOf = (w: string): string =>
			w.endsWith('/+route') ? w.slice(0, -'/+route'.length) : w === '+route' ? '' : w
		// Keep wrappers at-or-above the named ancestor (root-first order).
		// resolveLayoutHint already rejected non-ancestor dirs, so a miss
		// here can only mean the wrapper set changed under us — keep bare.
		const idx = wrappers.findIndex((w) => dirOf(w) === cut)
		if (idx < 0) return []
		return wrappers.slice(0, idx + 1)
	}
	try {
		const { entries: svelteEntries } = collectSvelteManifest(routesAbs, routesDir, vMods)
		svelteEntriesForChunk = svelteEntries
		for (const e of svelteEntries) {
			if (e.layout !== null) layoutByMod.set(e.svelte.replace(/\.svelte$/, ''), e.layout)
			if (typeof e.csr === 'boolean') csrByMod.set(e.svelte.replace(/\.svelte$/, ''), e.csr)
		}
		const dispMods = new Set(dispatched.map((d) => d.mod))
		for (const e of svelteEntries) {
			if (e.kind === 'wrapper' || e.kind === 'error') continue
			const mod = e.svelte.replace(/\.svelte$/, '')
			if (dispMods.has(mod)) continue // already covered by dispatched UI entry
			const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : ''
			const wrappers: string[] = []
			let cur = dir
			for (;;) {
				const cand = `${cur === '' ? '+route' : `${cur}/+route`}.svelte`
				if (existsSync(join(routesAbs, ...cand.split('/'))))
					wrappers.unshift(cand.replace(/\.svelte$/, ''))
				if (cur === '') break
				cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''
			}
			svelteOnly.push({ route: e.route, mod, wrappers })
		}
	} catch {
		/* svelte-only entries best-effort */
	}
	// hasLoad per page mod: True when the leaf .v or any wrapper .v above it
	// declares @[load]. The client router gates its JSON preload fetch on
	// this — static pages mount with params only, no request at all.
	const loadMods = new Set<string>()
	for (const f of routeFiles) {
		try {
			if (parseVFile(readFileSync(f, 'utf8')).some((x) => x.attr === 'load'))
				loadMods.add(modulePath(routesAbs, f))
		} catch {
			/* ignore */
		}
	}
	const entries: { route: string; mod: string; wrappers: string[] }[] = []
	for (const d of dispatched) {
		const pageFile = `${join(routesAbs, ...d.mod.split('/'))}.svelte`
		if (!existsSync(pageFile)) continue // headless API route: no UI
		const dir = d.mod.includes('/') ? d.mod.slice(0, d.mod.lastIndexOf('/')) : ''
		const wrappers: string[] = []
		let cur = dir
		for (;;) {
			const cand = `${cur === '' ? '+route' : `${cur}/+route`}.svelte`
			if (existsSync(join(routesAbs, ...cand.split('/'))))
				wrappers.unshift(cand.replace(/\.svelte$/, ''))
			if (cur === '') break
			cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''
		}
		entries.push({ route: d.route, mod: d.mod, wrappers: cutWrappers(d.mod, wrappers) })
	}
	for (const s of svelteOnly) entries.push({ ...s, wrappers: cutWrappers(s.mod, s.wrappers) })
	const rank = (p: string) => (p.includes('[') ? (p.includes('...') ? 2 : 1) : 0)
	entries.sort((a, b) => rank(a.route) - rank(b.route) || a.route.localeCompare(b.route))
	// Chunking: global mode (single|layout|route, default layout) + per-file
	// `export const chunk` hints (leaf/wrapper `.ts`, `eager|lazy|inherit`).
	// `single` keeps today's static imports byte-identical; `layout`/`route`
	// emit `() => import()` per chunk key (CSS follows JS via cssCodeSplit).
	// Chunk key reads `+route.svelte` existence; wrapper `.ts` only pins.
	const chunkMode: 'single' | 'layout' | 'route' =
		appChunking === 'single' || appChunking === 'route' ? appChunking : 'layout'
	const wrapperMods = new Set<string>()
	for (const e of svelteEntriesForChunk)
		if (e.kind === 'wrapper') wrapperMods.add(e.svelte.replace(/\.svelte$/, ''))
	const entryByMod = new Map(
		svelteEntriesForChunk.map((e) => [e.svelte.replace(/\.svelte$/, ''), e])
	)
	const chunkOf = (mod: string): string => {
		const n = entryByMod.get(mod)
		return chunkKeyFor(
			chunkMode,
			{
				svelte: `${mod}.svelte`,
				kind: (n?.kind ?? 'page') as 'page' | 'plain' | 'error' | 'wrapper',
				chunk: n?.chunk ?? 'inherit',
			},
			wrapperMods
		)
	}
	const chunkMods = new Map<string, string[]>()
	for (const e of entries) {
		const mods = [e.mod, ...e.wrappers]
		for (const m of mods) {
			const k = chunkOf(m)
			const arr = chunkMods.get(k) ?? []
			if (!arr.includes(m)) arr.push(m)
			chunkMods.set(k, arr)
		}
	}
	const lazy = chunkMode !== 'single'
	// Publish mod -> chunk key for manualChunks: `.swelte/` +
	// `chunks.json`, read back at bundle time (config() runs
	// before generate() in a fresh process, so disk — never
	// closure state). Null under `single` (Vite defaults).
	// Publish mod -> chunk key for manualChunks is returned (the caller
	// writes/removes `.swelte/chunks.json`; config() runs before generate()
	// in a fresh process, so disk — never closure state). Null under `single`.
	const chunks = lazy
		? { mode: chunkMode, chunks: Object.fromEntries(chunkMods) as Record<string, string[]> }
		: null
	const loaderSym = (mod: string) => `__swelteLoad_${mod.replace(/[^A-Za-z0-9_]/g, '_')}`
	const o: string[] = ['// Auto-generated by swelte from src/routes. Do not edit.', '']
	const universal = new Map<string, string>()
	for (const mod of new Set(entries.flatMap((e) => [e.mod, ...e.wrappers]))) {
		for (const ext of ['.ts', '.js']) {
			const file = join(routesAbs, mod + ext)
			if (!existsSync(file)) continue
			if (
				/export\s+(?:async\s+)?function\s+load\b|export\s+const\s+load\b/.test(
					readFileSync(file, 'utf8')
				)
			) {
				const symbol = `Universal_${universal.size}`
				o.push(`import * as ${symbol} from '../${routesDir}/${mod}${ext}'`)
				universal.set(mod, symbol)
			}
			break
		}
	}
	o.push(
		`const UNIVERSAL = { ${[...universal].map(([mod, symbol]) => `${JSON.stringify(mod)}: ${symbol}.load`).join(', ')} }`
	)
	const sym = (mod: string, suffix: string) => `R_${mod.replace(/[^A-Za-z0-9_]/g, '_')}${suffix}`
	const emittedSyms = new Set<string>()
	if (!lazy) {
		for (const e of entries) {
			o.push(`import ${sym(e.mod, '_Page')} from '../${routesDir}/${e.mod}.svelte'`)
			for (const w of e.wrappers) {
				const wSym = sym(w, '_Wrap')
				if (!emittedSyms.has(wSym)) {
					emittedSyms.add(wSym)
					o.push(`import ${wSym} from '../${routesDir}/${w}.svelte'`)
				}
			}
		}
	} else {
		// One loader per chunk key; every member resolves through it so a
		// layout + its pages share one `import()` (no waterfall inside).
		const sortedKeys = [...chunkMods.keys()].sort()
		for (const k of sortedKeys) {
			for (const m of chunkMods.get(k)!.sort()) {
				if (!emittedSyms.has(m)) {
					emittedSyms.add(m)
					o.push(`const ${loaderSym(m)} = () => import('../${routesDir}/${m}.svelte')`)
				}
			}
		}
	}
	const boundaries = collectErrorBoundaries(svelteEntriesForChunk)
	const boundaryFiles = [
		...new Set(boundaries.flatMap((boundary) => [...boundary.wrappers, boundary.svelte])),
	]
	for (const [index, file] of boundaryFiles.entries())
		o.push(`import SwelteBoundary${index} from '../${routesDir}/${file}'`)
	o.push(`const ERROR_BOUNDARIES = ${JSON.stringify(boundaries)}`)
	o.push(
		`const ERROR_COMPONENTS = { ${boundaryFiles.map((file, index) => `${JSON.stringify(file)}: SwelteBoundary${index}`).join(', ')} }`
	)
	o.push(selectErrorBoundaries.toString(), errorBoundaryProps.toString())

	o.push(`
import { flushSync, mount, hydrate, unmount } from 'svelte'
import { createProps } from './app/props.svelte.js'

const __swelteMatcherFns = { ${[...matchers.values()].map((md) => `${md.name}: (s) => { ${md.jsBody} }`).join(', ')} }
function __swelteSegName(seg) {
	const m = /^\\[([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*)\\]$/.exec(seg)
	if (m) return { name: m[1], matcher: m[2] }
	return { name: seg.slice(1, -1), matcher: null }
}
function matchSegs(pattern, pathname) {
	const pat = pattern.split('/').filter((s) => s !== '')
	const got = pathname.split('/').filter((s) => s !== '')
	const params = {}
	let gi = 0
	for (let pi = 0; pi < pat.length; pi++) {
		const seg = pat[pi]
		if (seg.startsWith('[...') && seg.endsWith(']')) { params[seg.slice(4, -1)] = got.slice(gi).map(decodeURIComponent).join('/'); gi = got.length; break }
		// Item 2 double-bracket optional: matches zero or one segment.
		if (seg.startsWith('[[') && seg.endsWith(']]')) {
			const name = seg.slice(2, -2)
			if (pi === pat.length - 1 && gi >= got.length) { params[name] = ''; break }
			if (gi >= got.length || !got[gi]) return null
			params[name] = decodeURIComponent(got[gi++])
			continue
		}
		if (seg.startsWith('[') && seg.endsWith(']')) { if (gi >= got.length || !got[gi]) return null; const { name: __nm, matcher: __mm } = __swelteSegName(seg); if (__mm) { const __ck = __swelteMatcherFns[__mm]; if (__ck && !__ck(got[gi])) return null } params[__nm] = decodeURIComponent(got[gi++]); continue }
		if (got[gi++] !== seg) return null
	}
	return gi === got.length ? params : null
}

export const ROUTES = [
`)
	for (const e of entries) {
		const noCsr = csrByMod.get(e.mod) === false
		const csrFlag = noCsr ? ', csr: false' : ''
		const metadata = `, mod: ${JSON.stringify(e.mod)}, wrapperMods: ${JSON.stringify(e.wrappers)}, id: ${JSON.stringify(`/${e.mod.replace(/(^|\/)(\+page|index)$/, '').replace(/\/$/, '')}`)}`
		if (!lazy) {
			const wraps = e.wrappers.map((w) => sym(w, '_Wrap')).join(', ')
			o.push(
				`\t{ path: ${JSON.stringify(e.route)}, page: ${sym(e.mod, '_Page')}, wrappers: [${wraps}], hasLoad: ${loadMods.has(e.mod) || e.wrappers.some((w) => loadMods.has(w)) ? 'true' : 'false'}${csrFlag}${metadata} },`
			)
		} else {
			// Lazy: resolve members through their chunk loaders, cache in
			// flight so layout+page share one network round-trip.
			const wraps = e.wrappers.map((w) => loaderSym(w)).join(', ')
			const mods = [e.mod, ...e.wrappers].map((m) => JSON.stringify(m)).join(', ')
			o.push(
				`\t{ path: ${JSON.stringify(e.route)}, page: ${loaderSym(e.mod)}, wrappers: [${wraps}], chunkMods: [${mods}], hasLoad: ${loadMods.has(e.mod) || e.wrappers.some((w) => loadMods.has(w)) ? 'true' : 'false'}${csrFlag}${metadata} },`
			)
		}
	}
	o.push(`]

let __mountedRoots = []
let __levelProps = []
let __lastEnvelope = null
function __dataFor(envelope, mod, leaf) {
  if (!envelope || envelope.version !== 1) return envelope?.data || {}
  if (leaf) return envelope.data || {}
  if (envelope.levels?.[mod] !== undefined) return envelope.levels[mod]
  let data = {}
  for (const [name, value] of Object.entries(envelope.levels || {})) {
    if (name === '+route' || (name.endsWith('/+route') && mod.startsWith(name.slice(0, -6)))) data = value
  }
  return data
}
async function __prepareData(r, envelope, params, url) {
  if (envelope?._view) return envelope
  envelope = envelope || { version: 1, data: {}, levels: {}, form: null }
  envelope.levels = { ...envelope.levels }
  let inherited = {}
  for (const mod of [...r.wrapperMods, r.mod]) {
    const fn = UNIVERSAL[mod]
    const leaf = mod === r.mod
    const native = envelope.levels[mod] ?? __dataFor(envelope, mod, leaf)
    let data = envelope.compat ? { ...inherited, ...native } : { ...native, ...inherited }
    if (fn) {
      const props = envelope.compat ? { params, data, form: envelope.form } : { params, ...data }
      const sdk = __routerSdk()
      const run = (depends = () => {}) => fn({ params, props, url, depends })
      const output = await (sdk?.__swelteTrackLoad ? sdk.__swelteTrackLoad(mod, run) : run())
      if (output && typeof output === 'object') { data = { ...data, ...output }; inherited = { ...inherited, ...output } }
    }
    if (leaf) envelope.data = data
    else envelope.levels[mod] = data
    if (envelope.compat) inherited = data
  }
  envelope._view = true
  return envelope
}
function __propsValue(r, envelope, params, mod, leaf) {
  const data = __dataFor(envelope, mod, leaf)
  return envelope?.compat ? { params, data, form: envelope.form ?? null } : { params, ...data, form: envelope?.form ?? null }
}
function __props(r, envelope, params, mod, leaf) {
  const props = createProps(__propsValue(r, envelope, params, mod, leaf))
  __levelProps.push({ r, props, mod, leaf, params })
  return props
}
function __publish(r, envelope, url, params, state) {
  __lastEnvelope = envelope
  __routerMounted = { url, params, route: envelope?.route?.id ?? r.id, routeInfo: envelope?.route ?? { id: r.id, pattern: r.path }, data: envelope?.data ?? {}, form: envelope?.form ?? null, status: envelope?.status ?? 200, error: envelope?.error ?? null, state }
  __setPage(__routerMounted)
}
const __swelteCompCache = new Map()
async function __swelteResolve(loader, mod) {
	if (__swelteCompCache.has(mod)) return __swelteCompCache.get(mod)
	const p = Promise.resolve().then(loader).then((m) => m && (m.default || m)).then((c) => { __swelteCompCache.set(mod, c); return c }).catch((e) => { __swelteCompCache.delete(mod); throw e })
	__swelteCompCache.set(mod, p)
	return p
}
function __swelteResolveRoute(r) {
	const mods = r.chunkMods || []
	if (!mods.length) return Promise.resolve({ page: r.page, wrappers: r.wrappers })
	const loaders = [r.page, ...r.wrappers]
	return Promise.all(mods.map((m, i) => (typeof loaders[i] === 'function' ? __swelteResolve(loaders[i], m) : loaders[i]))).then((comps) => ({ page: comps[0], wrappers: comps.slice(1) }))
}
function __teardownMounted() {
	for (const inst of __mountedRoots) { try { flushSync(() => unmount(inst)) } catch {} }
	__mountedRoots = []
	__levelProps = []
}
// Swap without an empty frame: teardown and mount inside one flushSync so
// no intermediate commit callbacks run with a null batch — that window is
// where Svelte's DEV-only await_reactivity_loss tracker fires on an
// unrelated each block (see /router/live). Mount off-DOM, move the new
// tree in, then drop the old tree: atomic swap, no blank flash.
function __swapIn(target, build) {
	const host = document.createElement('div')
	const oldRoots = __mountedRoots
	__mountedRoots = []
	const inst = build(host)
	const next = host.firstChild
	flushSync(() => {
		if (!next) {
			target.innerHTML = ''
		} else {
			target.insertBefore(next, target.firstChild)
			while (target.childNodes.length > 1) target.removeChild(target.lastChild)
		}
		for (const o of oldRoots) { try { unmount(o) } catch {} }
	})
	__mountedRoots = inst ? (Array.isArray(inst) ? inst.flat() : [inst]) : []
}
function __renderError(target, pathname, error, envelope, hydrating = false) {
  const hit = __matchRoute(pathname)
  let candidates = selectErrorBoundaries(ERROR_BOUNDARIES, hit?.route.mod ?? null, pathname)
  const marker = target.getAttribute?.('data-swelte-error-boundary')
  if (hydrating && marker) {
    const selected = candidates.findIndex((boundary) => encodeURIComponent(boundary.svelte) === marker)
    if (selected >= 0) candidates = candidates.slice(selected)
  }
  for (const boundary of candidates) {
    const keys = [...boundary.wrappers, boundary.svelte]
    const tree = (anchor) => {
      const level = (index, target) => {
        const key = keys[index]
        const leaf = index === keys.length - 1
        const props = errorBoundaryProps(envelope, key.slice(0, -7), error, leaf)
        if (!leaf) props.children = (inner) => level(index + 1, inner)
        ERROR_COMPONENTS[key](target, props)
      }
      level(0, anchor)
    }
    try {
      const inst = hydrating ? hydrate(tree, { target, recover: false }) : flushSync(() => mount(tree, { target }))
      __mountedRoots = [inst]
      return true
    } catch (failure) {
      if (hydrating) throw failure
      target.textContent = ''
    }
  }
  return false
}
export async function mountSwelteRoute(target, pathname, errorProps = undefined) {
	if (errorProps?.error) {
		__teardownMounted()
		target.textContent = ''
		if (!__renderError(target, pathname, errorProps.error, errorProps)) target.textContent = errorProps.error.message
		return { params: errorProps.params ?? {}, path: null }
	}
	const noparse = String(pathname ?? '').split('#')[0]
	const pathonly = noparse.split('?')[0] || '/'
	const path = pathonly !== '/' && pathonly.endsWith('/') ? pathonly.slice(0, -1) : pathonly
	try {
	for (const r of ROUTES) {
		const params = matchSegs(r.path, path)
		if (!params) continue
		// csr=false: SSR HTML only — client mount is a no-op (server HTML stays).
		if (r.csr === false) return { params, path: r.path }
		const __rc = await __swelteResolveRoute(r)
		const __page = __rc.page
		const __wraps = __rc.wrappers
		errorProps = await __prepareData(r, errorProps, params, pathname)
		__levelProps = []
		__publish(r, errorProps, pathname, params)
		// Leaf-first: page mounts into host[0]; each wrapper mounts with \`children\`
		// as a Snippet appending the inner host — leaf renders inside wrapper
		// nav/chrome with no manual import in +page.svelte.
	// Client mounts merge preloaded JSON into leaf props (same shape as SSR props).
	const leafData = (errorProps && typeof errorProps === 'object' && errorProps.data && typeof errorProps.data === 'object') ? errorProps.data : {}
	const leafProps = __props(r, errorProps, params, r.mod, true)
	const build = (swapHost) => {
		const hosts = [document.createElement('div')]
		const pageInst = mount(__page, { target: hosts[0], props: leafProps })
		const wrapInsts = []
		for (let i = r.wrappers.length - 1; i >= 0; i--) {
			const host = document.createElement('div')
			const inner = hosts[hosts.length - 1]
			const snip = (anchor) => { anchor.before(inner) }
			const wrapperProps = __props(r, errorProps, params, r.wrapperMods[i], false)
			wrapperProps.children = snip
			wrapInsts.push(mount(__wraps[i], { target: host, props: wrapperProps }))
			hosts.push(host)
		}
		swapHost.appendChild(hosts[hosts.length - 1])
		return [pageInst, ...wrapInsts]
	}
	if (target.childNodes.length === 0) {
		// Cold boot (empty #app): mount directly, no swap needed.
		const host = document.createElement('div')
		let insts = null
		flushSync(() => {
			insts = build(host)
			const next = host.firstChild
			if (next) target.appendChild(next)
		})
		__mountedRoots = Array.isArray(insts) ? insts.flat() : [insts]
	} else {
		// Client navigation: build off-DOM, then swap atomically.
		// Teardown the old tree FIRST inside the same flushSync (old
		// effects destroyed before the new tree mounts), so the old page's
		// each-block commit callbacks can't fire while the new page's async
		// boundary tracker is live — that overlap is the /router/live
		// await_reactivity_loss source (both batches null + stale each read).
		const host = document.createElement('div')
		const oldRoots = __mountedRoots
		__mountedRoots = []
		const insts = build(host)
		const next = host.firstChild
		flushSync(() => {
			for (const o of oldRoots) { try { unmount(o) } catch {} }
			if (next) {
				target.insertBefore(next, target.firstChild)
				while (target.childNodes.length > 1) target.removeChild(target.lastChild)
			}
		})
		__mountedRoots = Array.isArray(insts) ? insts.flat() : [insts]
	}
	return { params, path: r.path }
	}
	__teardownMounted()
	target.textContent = ''
	if (__renderError(target, pathname, errorProps ?? { status: 404, message: 'not found' }, errorProps)) return { params: {}, path: null }
	throw new Error('swelte: no route for ' + pathname)
	} catch (failure) {
		const error = { status: 500, message: 'render failed' }
		__teardownMounted()
		target.textContent = ''
		const hit = __matchRoute(pathname)
		if (hit) __publish(hit.route, { ...errorProps, status: 500, error }, pathname, hit.params)
		if (__renderError(target, pathname, error, errorProps)) return { params: hit?.params ?? {}, path: null }
		throw failure
	}
}
`)
	o.push(`
// SSR hydrate path: when Hand fills <!--ssr-body-->
// the same component tree hydrates in place instead of mounting fresh.
// Wrapper routes hydrate nested: one top-level hydrate() of the outermost
// wrapper, with each level's children snippet invoking the inner component
// directly on the snippet anchor. Svelte's hydration cursor is already
// positioned at the SSR slot, so every level adopts its SSR DOM and the
// leaf page takes over without remount. Falls back to mount on mismatch.
export async function hydrateSwelteRoute(target, pathname, errorProps = undefined) {
	const hydrationTarget = target.firstElementChild?.getAttribute('data-swelte-ssr') === '1' ? target.firstElementChild : target
	try {
		if (errorProps?.error) {
			const hit = __matchRoute(pathname)
			if (hit) __publish(hit.route, errorProps, pathname, errorProps.params ?? hit.params)
			if (!__renderError(hydrationTarget, pathname, errorProps.error, errorProps, true)) target.textContent = errorProps.error.message
			return { params: errorProps.params ?? {}, path: null, hydrated: true }
		}
		const noparse = String(pathname ?? '').split('#')[0]
		const pathonly = noparse.split('?')[0] || '/'
		const path = pathonly !== '/' && pathonly.endsWith('/') ? pathonly.slice(0, -1) : pathonly
		for (const r of ROUTES) {
			const params = matchSegs(r.path, path)
			if (!params) continue
			// csr=false: SSR HTML only - hydration is a deliberate no-op (server HTML stays).
			if (r.csr === false) return { params, path: r.path, hydrated: false }
			errorProps = await __prepareData(r, errorProps, params, pathname)
			__levelProps = []
			__publish(r, errorProps, pathname, params)
			if (r.wrappers.length > 0) {
				// Root-first closure chain: the outermost hydrate()'s
				// children snippet invokes the next wrapper with *its*
				// children snippet, down to the leaf page. Each level runs
				// while Svelte's hydration cursor sits on its SSR slot, so
				// the whole tree adopts SSR DOM instead of remounting.
				const leafData = (errorProps && typeof errorProps === 'object' && errorProps.data && typeof errorProps.data === 'object') ? errorProps.data : {}
				const leafExtra = (errorProps && typeof errorProps === 'object' && !errorProps.data) ? errorProps : {}
				const leafProps = __props(r, errorProps, params, r.mod, true)
				const __rc0 = await __swelteResolveRoute(r)
				let child = (anchor) => { __rc0.page(anchor, leafProps) }
				for (let i = r.wrappers.length - 1; i >= 1; i--) {
					const Wrap = __rc0.wrappers[i]
					const inner = child
					const props = __props(r, errorProps, params, r.wrapperMods[i], false)
					props.children = inner
					child = (anchor) => { Wrap(anchor, props) }
				}
				const props = __props(r, errorProps, params, r.wrapperMods[0], false)
				props.children = child
				__mountedRoots = [hydrate(__rc0.wrappers[0], { target: hydrationTarget, props, recover: false })]
				return { params, path: r.path, hydrated: true }
			}
			const __rc1 = await __swelteResolveRoute(r)
			__mountedRoots = [hydrate(__rc1.page, { target: hydrationTarget, props: __props(r, errorProps, params, r.mod, true), recover: false })]
			return { params, path: r.path, hydrated: true }
		}
		if (__renderError(hydrationTarget, pathname, errorProps ?? { status: 404, message: 'not found' }, errorProps, true)) {
			return { params: {}, path: null, hydrated: true }
		}
	} catch (error) {
		globalThis.dispatchEvent?.(new CustomEvent('swelte:hydration-fallback', { detail: { pathname, error } }))
		if (globalThis.__swelteStrictHydration) throw error
	}
	return { ...(await mountSwelteRoute(target, pathname, errorProps)), hydrated: false }
}

// §1.4 client router: history-driven navigation with data preloading,
// cancellable guards, and reactive stores (wired lazily so routes.js
// never hard-depends on the SDK bundle shape).
let __routerTarget = null
let __routerMounted = null
function __routerSdk() { return (typeof globalThis !== 'undefined' && globalThis.__swelteRouterSdk) || null }
function __setPage(s) { const sdk = __routerSdk(); if (sdk && sdk.page) sdk.page.set(s) }
function __setNavigating(s) { const sdk = __routerSdk(); if (sdk && sdk.navigating) sdk.navigating.set(s) }
async function __runGuards(kind, arg) {
	const sdk = __routerSdk(); if (!sdk) return false
	const fns = kind === 'before' ? (sdk.__beforeNav || []) : (sdk.__afterNav || [])
	for (const fn of fns) {
		let cancelled = false
		const extra = kind === 'before' ? { cancel: () => { cancelled = true } } : {}
		await fn({ ...arg, ...extra })
		if (kind === 'before' && cancelled) return true
	}
	return false
}
function __matchRoute(pathname) {
	const noparse = String(pathname ?? '').split('#')[0]
	const pathonly = noparse.split('?')[0] || '/'
	const path = pathonly !== '/' && pathonly.endsWith('/') ? pathonly.slice(0, -1) : pathonly
	for (const r of ROUTES) {
		const params = matchSegs(r.path, path)
		if (params) return { route: r, params }
	}
	return null
}
function __fullUrl(url, pathname) {
	// Keep the caller's query/hash for history + data fetch: strings carry
	// them verbatim, URL objects rebuild from their parts.
	if (typeof url === 'string') return url
	try {
		return pathname + url.search + url.hash
	} catch {
		return pathname
	}
}
export async function goto(url, opts) {
	opts = opts || {}
	const navigation = ++__navigationId
	++__pageNavigationId
	__pendingNavigation = navigation
	try {
	const destination = new URL(url, location.href)
	if (destination.origin !== location.origin) { location.href = destination.href; return }
	const to = destination.pathname + destination.search + destination.hash
	const from = __routerMounted ? __routerMounted.url : null
	__setNavigating({ from, to })
	const cancelled = await __runGuards('before', { from: __routerMounted, to })
	if (navigation !== __navigationId) return
	if (cancelled) { __setNavigating(null); return }
	if (!opts.replaceState) history.pushState(__swelteHistState(), '', to)
	else history.replaceState(__swelteHistState(), '', to)
	await __navigateTo(to, { ...opts, navigation })
	} finally { if (__pendingNavigation === navigation) __pendingNavigation = 0 }
}
function __swelteSnap() { try { const sdk = __routerSdk(); return sdk && sdk.__swelteCaptureSnapshot ? sdk.__swelteCaptureSnapshot() : {} } catch { return {} } }
function __swelteHistState(pageState) { return { 'swelte:snap': __swelteSnap(), ...(pageState !== undefined ? { 'page-state': pageState } : {}) } }
function __swelteRestore(histState) { try { const sdk = __routerSdk(); const snap = histState && typeof histState === 'object' ? histState['swelte:snap'] : undefined; if (snap && typeof snap === 'object' && sdk && sdk.__swelteRestoreSnapshot) sdk.__swelteRestoreSnapshot(snap) } catch {} }
function __sweltePageStateOf(histState, fallback) {
if (histState && typeof histState === 'object' && histState['page-state'] && typeof histState['page-state'] === 'object') return histState['page-state']
return fallback
}
export async function preloadData(url) {
	const destination = new URL(url, location.href)
	const pathname = destination.pathname
	const to = destination.pathname + destination.search
	const hit = __matchRoute(pathname)
	if (!hit) return null
	// Static pages (no @[load] anywhere on the chain) carry no page data:
	// skip the preload fetch entirely — no request, no 404 noise.
	try {
		const res = await fetch(to, { headers: { accept: 'application/json', 'X-Swelte-Load': '1' } })
		const data = await res.json().catch(() => null)
		return { route: hit.route.path, params: hit.params, data, status: res.status }
	} catch (e) { return { route: hit.route.path, params: hit.params, data: null, status: 0 } }
}
export async function pushState(url, state) {
	++__pageNavigationId; ++__navigationId
	state = state || {}
	const pageState = state['page-state']
	const destination = new URL(url, location.href)
	const to = destination.pathname + destination.search + destination.hash
	history.pushState(__swelteHistState(pageState), '', to)
	__routerMounted = { ...(__routerMounted || {}), url: to, state: pageState ?? __routerMounted?.state }
	__setPage(__routerMounted)
}
export async function replaceState(url, state) {
	++__pageNavigationId; ++__navigationId
	state = state || {}
	const pageState = state['page-state']
	const destination = new URL(url, location.href)
	const to = destination.pathname + destination.search + destination.hash
	history.replaceState(__swelteHistState(pageState), '', to)
	__routerMounted = { ...(__routerMounted || {}), url: to, state: pageState ?? __routerMounted?.state }
	__setPage(__routerMounted)
}
export async function preloadCode(url) {
	const pathname = typeof url === 'string' ? String(url).split('#')[0].split('?')[0] || '/' : url.pathname
	const to = __fullUrl(url, pathname)
	const hit = __matchRoute(pathname)
	if (!hit) return null
	if (hit.route.chunkMods) { try { await __swelteResolveRoute(hit.route) } catch {} }
	return { route: hit.route.path, params: hit.params, cached: true }
}
async function __navigateTo(pathname, opts) {
	opts = opts || {}
	if (opts.refresh && __pendingNavigation) return
	const navigation = opts.navigation ?? ++__navigationId
	if (!opts.refresh) {
		if (!opts.navigation) ++__pageNavigationId
		__pendingNavigation = navigation
	}
	try { return await __navigateToInner(pathname, { ...opts, navigation }) }
	finally { if (__pendingNavigation === navigation) __pendingNavigation = 0 }
}
async function __navigateToInner(pathname, opts) {
	opts = opts || {}
	const destination = new URL(pathname, location.href)
	pathname = destination.pathname + destination.search + destination.hash
	const navigation = opts.navigation ?? ++__navigationId
	const target = __routerTarget || document.getElementById('app')
	if (!target) return
	const hit = __matchRoute(pathname)
	const from = __routerMounted ? __routerMounted.url : null
	if (!hit) {
		__teardownMounted()
		target.textContent = ''
		if (__renderError(target, pathname, { status: 404, message: 'not found' }, null)) {
			__routerMounted = { url: pathname, params: {}, route: null, data: {}, error: { status: 404, message: 'not found' } }
			__setPage(__routerMounted); __setNavigating(null)
			await __runGuards('after', { from, to: __routerMounted })
			return
		}
		throw new Error('swelte: no route for ' + pathname)
	}
	// Fetch BEFORE touching the DOM: the old page stays painted while the
	// new page's data loads, and mountSwelteRoute swaps atomically —
	// no innerHTML blank frame while awaiting the network.
	const loaded = await preloadData(pathname)
	if (navigation !== __navigationId) return
	let envelope = loaded?.data?.version === 1 ? loaded.data : null
	if (envelope?.redirect) { await goto(envelope.redirect, { replaceState: true }); return }
	if (envelope?.error || (!envelope && (hit.route.hasLoad || !loaded?.status || loaded.status >= 400))) {
		const error = envelope?.error ?? { status: loaded?.status || 500, message: 'page load failed' }
		__teardownMounted()
		target.innerHTML = ''
		__publish(hit.route, { ...envelope, error, status: error.status }, pathname, hit.params)
		__renderError(target, pathname, error, envelope)
		__setNavigating(null)
		return
	}
	if (!opts.noPreloadCode && hit.route.chunkMods) { try { await __swelteResolveRoute(hit.route) } catch {} }
	try { envelope = await __prepareData(hit.route, envelope, hit.params, pathname) }
	catch (error) {
		if (navigation !== __navigationId) return
		console.error('[swelte] universal load failed', error)
		const failed = { ...envelope, status: 500, error: { status: 500, message: 'page load failed' } }
		__publish(hit.route, failed, pathname, hit.params)
		await mountSwelteRoute(target, pathname, failed)
		__setNavigating(null)
		return
	}
	if (navigation !== __navigationId) return
	if (opts.refresh && __routerMounted?.route === (envelope?.route?.id ?? hit.route.id) && __levelProps.length) {
		if (envelope && envelope.form == null) envelope.form = __routerMounted.form ?? null
		__publish(hit.route, envelope, pathname, hit.params, __routerMounted.state)
		flushSync(() => {
			for (const record of __levelProps) {
				const next = __propsValue(record.r, envelope, hit.params, record.mod, record.leaf)
				for (const key of Object.keys(record.props)) if (key !== 'children' && !(key in next)) delete record.props[key]
				Object.assign(record.props, next)
			}
		})
		__setNavigating(null)
		return
	}
	const out = await mountSwelteRoute(target, pathname, envelope ?? undefined)
	const popState = opts && typeof opts === 'object' ? opts.popstate : undefined
	__publish(hit.route, envelope, pathname, out.params ?? hit.params, popState)
	__setNavigating(null)
	await __runGuards('after', { from, to: __routerMounted })
}
let __navigationId = 0
let __pageNavigationId = 0
let __pendingNavigation = 0
export async function refresh() { await __navigateTo(location.pathname + location.search + location.hash, { refresh: true }) }
export async function refreshTagged(keys) {
  const match = __matchRoute(location.pathname)
  if (match && [...match.route.wrapperMods, match.route.mod].some(mod => keys.includes(mod))) await refresh()
}
export async function setError(error) {
  const target = __routerTarget || document.getElementById('app')
  ++__navigationId
  ++__pageNavigationId
  const next = { ...(__lastEnvelope || {}), version: 1, status: error.status, error, form: null, data: {} }
  const match = __matchRoute(location.pathname)
  if (match) {
    next.route = { id: match.route.id, pattern: match.route.path }
    next.params = match.params
    __publish(match.route, next, location.pathname + location.search + location.hash, match.params)
  }
  if (target) await mountSwelteRoute(target, location.pathname, next)
  __setNavigating(null)
}
export async function setForm(form, status = 200) {
  if (__lastEnvelope) { __lastEnvelope.form = form; __lastEnvelope.status = status; __lastEnvelope.error = null }
  if (__routerMounted) { __routerMounted.form = form; __routerMounted.status = status; __routerMounted.error = undefined; __setPage({ ...__routerMounted }) }
  flushSync(() => { for (const record of __levelProps) record.props.form = form })
}
export function initSwelteRouter(target) {
	__routerTarget = target || document.getElementById('app')
	if (typeof globalThis !== 'undefined') { globalThis.__swelteRoutes = { goto, preloadData, preloadCode, pushState, replaceState, refresh, refreshTagged, setForm, setError, initSwelteRouter, get actionRevision() { return __pageNavigationId } } }
	if (typeof window === 'undefined' || !__routerTarget) return () => {}
	const gotoOptsFor = (a, href) => {
		const opts = {}
		if (a.hasAttribute('data-sveltekit-noscroll') || a.hasAttribute('data-swelte-noscroll')) opts.noscroll = true
		if (a.hasAttribute('data-sveltekit-noreplace') || a.hasAttribute('data-swelte-noreplace')) opts.replaceState = true
		const preload = a.getAttribute('data-sveltekit-preload-data') ?? a.getAttribute('data-swelte-preload')
		if (preload === 'off' || a.hasAttribute('data-sveltekit-reload')) opts.noPreload = true
		if (a.getAttribute('data-sveltekit-preload-code') === 'off') opts.noPreloadCode = true
		void href
		return opts
	}
	const onHover = (e) => {
		const a = e.target && e.target.closest ? e.target.closest('a[href]') : null
		if (!a) return
		const href = a.getAttribute('href')
		if (!href || href.startsWith('#') || href.includes(':') || a.target === '_blank') return
		if (a.hasAttribute('download') || a.getAttribute('rel') === 'external') return
		if (a.getAttribute('data-sveltekit-preload-data') === 'off' || a.getAttribute('data-swelte-preload') === 'off') return
		if (a.hasAttribute('data-sveltekit-reload') || a.hasAttribute('data-swelte-reload')) return
		preloadData(href).catch(() => {})
		if (a.getAttribute('data-sveltekit-preload-code') !== 'off') preloadCode(href).catch(() => {})
	}
	const onClick = (e) => {
		const a = e.target && e.target.closest ? e.target.closest('a[href]') : null
		if (!a) return
		const href = a.getAttribute('href')
		if (!href || href.startsWith('#') || href.includes(':') || a.target === '_blank') return
		if (a.hasAttribute('download') || a.getAttribute('rel') === 'external') return
		if (a.hasAttribute('data-sveltekit-reload') || a.hasAttribute('data-swelte-reload')) return
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
		e.preventDefault()
		goto(href, gotoOptsFor(a, href))
	}
	const onPop = () => { __swelteRestore(history.state); __navigateTo(location.pathname + location.search + location.hash, { popstate: __sweltePageStateOf(history.state, undefined) }) }
	window.addEventListener('pointerover', onHover)
	window.addEventListener('click', onClick)
	window.addEventListener('popstate', onPop)
	return () => { window.removeEventListener('pointerover', onHover); window.removeEventListener('click', onClick); window.removeEventListener('popstate', onPop) }
}
`)
	return { lines: o, chunks }
}
