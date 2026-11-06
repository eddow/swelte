import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { SvelteRouteEntry } from './vite.js'
import {
	assertLayoutHint,
	assertLimitsHint,
	chunkKeyFor,
	collectSvelteManifest,
	readCsrFlag,
	readLayoutHint,
	resolveLayoutHint,
	siblingLoadSource,
	svelteRouteFor,
	universalLoadKind,
} from './vite.js'

function tmpRoutes(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'swelte-mani-'))
	const routesAbs = join(root, 'src', 'routes')
	mkdirSync(routesAbs, { recursive: true })
	for (const [rel, src] of Object.entries(files)) {
		const abs = join(routesAbs, rel)
		mkdirSync(join(abs, '..'), { recursive: true })
		writeFileSync(abs, src)
	}
	return routesAbs
}

describe('collectSvelteManifest (tmp routes)', () => {
	it('wrapper chain order: wrappers listed, page hasData paired with .v', () => {
		const routesAbs = tmpRoutes({
			'admin/+route.svelte': '<slot />',
			'admin/+page.svelte': '<h1>a</h1>',
			'admin/+page.v': 'module p\n@[get] pub fn g() string { return "" }',
		})
		const { entries, hasError } = collectSvelteManifest(
			routesAbs,
			'src/routes',
			new Set(['admin/+page'])
		)
		assert.equal(hasError, false)
		// Wrappers keep their mod in the entry route (`/+route` suffix);
		// dispatch never routes them (routeFor -> null for wrappers).
		assert.deepEqual(
			entries.map((e: SvelteRouteEntry) => [e.route, e.kind, e.hasData]).sort(),
			[
				['/admin', 'page', true],
				['/admin/+route', 'wrapper', false],
			].sort()
		)
	})

	it('basename sibling .ts flags hasUniversalLoad (+page + plain)', () => {
		const routesAbs = tmpRoutes({
			'admin/+page.svelte': '<h1>a</h1>',
			'admin/+page.ts': 'export function load() { return {} }',
			'dash.svelte': '<h1>d</h1>',
			'dash.ts': 'export function load() { return {} }',
			'bare.svelte': '<h1>b</h1>',
			'nojs.svelte': '<h1>n</h1>',
			'nojs.ts': 'export const ssr = false;\nexport async function load() { return {} }',
		})
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set())
		const by = (svelte: string) => entries.find((e: SvelteRouteEntry) => e.svelte === svelte)
		assert.equal(by('admin/+page.svelte')?.hasUniversalLoad, 'sync')
		assert.equal(by('dash.svelte')?.hasUniversalLoad, 'sync')
		assert.equal(by('bare.svelte')?.hasUniversalLoad, false)
		assert.equal(by('nojs.svelte')?.hasUniversalLoad, 'async')
		// ssr flag: false only when opted out; wrappers inherit the same read.
		assert.equal(by('admin/+page.svelte')?.ssr, true)
		assert.equal(by('nojs.svelte')?.ssr, false)
	})

	it('+error global-only: nested throws', () => {
		const routesAbs = tmpRoutes({ 'admin/+error.svelte': '<p>e</p>' })
		assert.throws(
			() => collectSvelteManifest(routesAbs, 'src/routes', new Set()),
			/only src\/routes\/\+error\.svelte exists/
		)
	})

	it('headless api route excluded from entries', () => {
		// No .svelte files at all: manifest is empty (api .v files never
		// enter the svelte manifest; dispatch is separate).
		const routesAbs = tmpRoutes({})
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set(['api/greet']))
		assert.deepEqual(entries, [])
	})

	it('dynamic shapes pass through verbatim', () => {
		const routesAbs = tmpRoutes({ 'users/[id]/+page.svelte': '<h1>u</h1>' })
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set())
		assert.equal(entries[0]?.route, '/users/[id]')
		assert.equal(svelteRouteFor('files/[...rest]/+page'), '/files/[...rest]')
	})

	it('.js sibling accepted (plain-JS: raw-bundled into sync render.js, skipped by tsc --strict)', () => {
		const routesAbs = tmpRoutes({
			'router/+page.svelte': '<h1>r</h1>',
			'router/+page.js': 'export function load({ props }) { return { v: String(props?.g ?? "") } }',
			'live/+page.svelte': '<h1>l</h1>',
			'live/+page.js': 'export const ssr = false;\nexport async function load() { return {} }',
		})
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set())
		const by = (svelte: string) => entries.find((e: SvelteRouteEntry) => e.svelte === svelte)
		assert.equal(by('router/+page.svelte')?.hasUniversalLoad, 'sync')
		assert.equal(by('router/+page.svelte')?.ssr, true)
		assert.equal(by('live/+page.svelte')?.hasUniversalLoad, 'async')
		assert.equal(by('live/+page.svelte')?.ssr, false)
		assert.ok(siblingLoadSource(join(routesAbs, 'router', '+page.ts'))?.endsWith('+page.js'))
		assert.equal(universalLoadKind(join(routesAbs, 'router', '+page.ts')), 'sync')
	})

	it('chunk hint defaults to inherit; wrapper +route.ts pins the subtree', () => {
		const routesAbs = tmpRoutes({
			'admin/+route.svelte': '<slot />',
			'admin/+route.ts': `export const chunk = 'lazy'`,
			'admin/+page.svelte': '<h1>a</h1>',
			'admin/+page.ts': `export const chunk = 'eager'`,
			'bare.svelte': '<h1>b</h1>',
		})
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set())
		const by = (svelte: string) => entries.find((e: SvelteRouteEntry) => e.svelte === svelte)
		assert.equal(by('admin/+route.svelte')?.chunk, 'lazy')
		assert.equal(by('admin/+page.svelte')?.chunk, 'eager')
		assert.equal(by('bare.svelte')?.chunk, 'inherit')
	})

	it('bad chunk hint throws with file+line', () => {
		const routesAbs = tmpRoutes({
			'bad.svelte': '<h1>b</h1>',
			'bad.ts': `export const chunk = 'sometimes'`,
		})
		assert.throws(() => collectSvelteManifest(routesAbs, 'src/routes', new Set()), /bad chunk hint/)
	})

	it('chunkKeyFor: layout bubbles wrapper-less folders, flat vs nested split', () => {
		const wrappers = new Set(['+route', 'admin/+route'])
		const e = (svelte: string, chunk?: 'eager' | 'lazy' | 'inherit') => ({
			svelte,
			kind: 'page' as const,
			chunk: chunk ?? 'inherit',
		})
		// layout: admin pages share the admin chunk; wrapper-less subfolder
		// bubbles up; root pages share the root chunk.
		assert.equal(chunkKeyFor('layout', e('admin/+page.svelte'), wrappers), 'layout:admin')
		assert.equal(chunkKeyFor('layout', e('admin/users.svelte'), wrappers), 'layout:admin')
		assert.equal(chunkKeyFor('layout', e('admin/audit/+page.svelte'), wrappers), 'layout:admin')
		assert.equal(chunkKeyFor('layout', e('+page.svelte'), wrappers), 'layout:/')
		assert.equal(chunkKeyFor('layout', e('about.svelte'), wrappers), 'layout:/')
		// flat foo.svelte skips foo/+route; nested foo/+page.svelte mounts it.
		const withChild = new Set(['+route', 'shop/+route'])
		assert.equal(chunkKeyFor('layout', e('shop.svelte'), withChild), 'layout:/')
		assert.equal(chunkKeyFor('layout', e('shop/+page.svelte'), withChild), 'layout:shop')
		// route: one chunk per leaf; eager hoists to the layout chunk.
		assert.equal(chunkKeyFor('route', e('admin/+page.svelte'), wrappers), 'page:admin')
		assert.equal(chunkKeyFor('route', e('admin/+page.svelte', 'eager'), wrappers), 'layout:admin')
		// single: everything in app unless forced lazy.
		assert.equal(chunkKeyFor('single', e('admin/+page.svelte'), wrappers), 'app')
		assert.equal(chunkKeyFor('single', e('admin/+page.svelte', 'lazy'), wrappers), 'page:admin')
		// eager wrapper collapses into its parent chunk; eager leaf is a no-op.
		const ew = { svelte: 'admin/+route.svelte', kind: 'wrapper' as const, chunk: 'eager' as const }
		assert.equal(chunkKeyFor('layout', ew, wrappers), 'layout:/')
		assert.equal(chunkKeyFor('layout', e('admin/+page.svelte', 'eager'), wrappers), 'layout:admin')
		// error page always stays in the entry chunk.
		assert.equal(
			chunkKeyFor('layout', { svelte: '+error.svelte', kind: 'error', chunk: 'inherit' }, wrappers),
			'app'
		)
		// layout-cut leaves chunk like pages (same dir rules).
		assert.equal(
			chunkKeyFor(
				'layout',
				{ svelte: 'admin/+page.svelte', kind: 'page', chunk: 'inherit' } as never,
				wrappers
			),
			'layout:admin'
		)
	})

	it('readLayoutHint: false/true/quoted dirs; rejects malformed', () => {
		assert.equal(readLayoutHint('export const layout = false'), false)
		assert.equal(readLayoutHint('export const layout = true'), true)
		assert.equal(readLayoutHint(`export const layout = 'admin'`), 'admin')
		assert.equal(readLayoutHint(`export const layout = "a/b"`), 'a/b')
		// normalize the annotation away — the union marker `|` can only
		// appear inside the annotation (a bare value never contains one),
		// so `: boolean | string` is tolerated like plain `: string`.
		assert.equal(readLayoutHint('export const layout: boolean | string = false;'), false)
		assert.equal(readLayoutHint(`export const layout = 'admin'; // keep admin`), 'admin')
		assert.equal(readLayoutHint('export function load() { return {} }'), null)
		// Unquoted garbage passes through for assertLayoutHint to reject.
		assert.equal(readLayoutHint('export const layout = 123'), '123')
		// An unclosed quote leaves a trailing `'`: without balanced quotes
		// the `;`-terminated regex grabs the comment too, so the check is
		// that unbalanced quoting never resolves to a clean value.
		const unbalanced = readLayoutHint(`export const layout = 'admin`)
		assert.ok(unbalanced !== 'admin')
		assert.throws(
			() => assertLayoutHint('f.ts:1', `export const layout = 'admin`),
			/bad layout hint/
		)

		assert.equal(assertLayoutHint('f.ts', 'export const layout = false'), false)
		assert.equal(assertLayoutHint('f.ts', 'export const layout = true'), true)
		assert.equal(assertLayoutHint('f.ts', `export const layout = 'admin'`), 'admin')
		assert.equal(assertLayoutHint('f.ts', `export const layout = "a/b"`), 'a/b')
		assert.equal(assertLayoutHint('f.ts', 'export const layout: boolean | string = false;'), false)
		assert.equal(assertLayoutHint('f.ts', 'no hint here'), null)
		assert.throws(
			() => assertLayoutHint('f.ts:1', `export const layout = ''`),
			/bad layout hint ''/
		)
		assert.throws(() => assertLayoutHint('f.ts:1', 'export const layout = 123'), /bad layout hint/)
		assert.throws(
			() => assertLayoutHint('f.ts:1', 'export const layout = someVar'),
			/bad layout hint/
		)
		assert.throws(
			() => assertLayoutHint('f.ts:1', `export const layout = '../admin'`),
			/bad layout hint/
		)
		// Explicit unsupported shapes stay build errors, not cuts.
		assert.throws(
			() => assertLayoutHint('f.ts:1', `export const layout = 'admin/'`),
			/bad layout hint/
		)
		assert.throws(
			() => assertLayoutHint('f.ts:1', `export const layout = '/admin'`),
			/bad layout hint/
		)
		// Dots move (`..`), groups (`(a)`) and dynamics (`[id]`) are never
		// legal cut dirs; `my.dir` fails the plain-dir rule too.
		for (const bad of [`'..'`, `'(a)'`, `'[id]'`, `'my.dir'`]) {
			assert.throws(
				() => assertLayoutHint('f.ts:1', `export const layout = ${bad}`),
				/bad layout hint/,
				bad
			)
		}
	})

	it('resolveLayoutHint: leaf > nearest wrapper; named cut validated', () => {
		const routesAbs = join(tmpdir(), 'swelte-layout-nonexistent')
		// Leaf wins over wrapper.
		assert.equal(
			resolveLayoutHint(
				'src/routes',
				routesAbs,
				'/admin',
				{ src: 'export const layout = false', file: join(routesAbs, 'admin', '+page.ts') },
				['admin', '']
			),
			false
		)
		// Null leaf hint → no wrappers → null (inherit).
		assert.equal(
			resolveLayoutHint(
				'src/routes',
				routesAbs,
				'/admin',
				{ src: 'export function load() {}', file: join(routesAbs, 'admin', '+page.ts') },
				[]
			),
			null
		)
		// Named cut that is not an ancestor wrapper dir fails with the file.
		assert.throws(
			() =>
				resolveLayoutHint(
					'src/routes',
					routesAbs,
					'/admin/settings',
					{
						src: `export const layout = 'nope'`,
						file: join(routesAbs, 'admin', 'settings', '+page.ts'),
					},
					['admin', '']
				),
			/no ancestor wrapper at that dir/
		)
	})

	it('layout knob: bare, named, plain-named; chain defaults stay full', () => {
		const routesAbs = tmpRoutes({
			'+route.svelte': '<slot />',
			'admin/+route.svelte': '<slot />',
			'admin/+page.svelte': '<h1>a</h1>',
			'admin/login/+page.svelte': '<h1>bare login</h1>',
			'admin/login/+page.ts': 'export const layout = false',
			'admin/settings/+page.svelte': '<h1>settings</h1>',
			'admin/settings/+page.ts': `export const layout = 'admin'`,
			// Plain-named leaf: layout works off about.ts, route stays /about.
			'about.svelte': '<h1>about</h1>',
			'about.ts': 'export const layout = false',
		})
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set())
		const by = (svelte: string) => entries.find((e: SvelteRouteEntry) => e.svelte === svelte)
		assert.equal(by('admin/login/+page.svelte')?.layout, false)
		assert.equal(by('admin/login/+page.svelte')?.route, '/admin/login')
		assert.equal(by('admin/settings/+page.svelte')?.layout, 'admin')
		assert.equal(by('about.svelte')?.layout, false)
		assert.equal(by('about.svelte')?.route, '/about')
		assert.equal(by('about.svelte')?.kind, 'plain')
		// Plain leaves inherit the full chain.
		assert.equal(by('admin/+page.svelte')?.layout, null)
		assert.equal(by('admin/+page.svelte')?.route, '/admin')
	})

	it('layout knob: subtree reset + true escape; bad hints fail', () => {
		const routesAbs = tmpRoutes({
			'+route.svelte': '<slot />',
			'admin/+route.svelte': '<slot />',
			'admin/+route.ts': 'export const layout = false',
			'admin/a/+page.svelte': '<h1>a</h1>',
			'admin/a/+page.ts': 'export const layout = true',
			'admin/b/+page.svelte': '<h1>b</h1>',
		})
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set())
		const by = (svelte: string) => entries.find((e: SvelteRouteEntry) => e.svelte === svelte)
		// Whole admin subtree bares; the `true` leaf opts back into the full chain.
		assert.equal(by('admin/b/+page.svelte')?.layout, false)
		assert.equal(by('admin/a/+page.svelte')?.layout, true)

		const badCut = tmpRoutes({
			'admin/+route.svelte': '<slot />',
			'admin/x/+page.svelte': '<h1>x</h1>',
			'admin/x/+page.ts': `export const layout = 'nope'`,
		})
		assert.throws(
			() => collectSvelteManifest(badCut, 'src/routes', new Set()),
			/no ancestor wrapper at that dir/
		)
		const badShape = tmpRoutes({
			'plain/+page.svelte': '<h1>p</h1>',
			'plain/+page.ts': 'export const layout = 123',
		})
		assert.throws(() => collectSvelteManifest(badShape, 'src/routes', new Set()), /bad layout hint/)
		const staleMod = tmpRoutes({
			'+route.svelte': '<slot />',
			'admin/login/+page@.svelte': '<h1>stale</h1>',
		})
		assert.throws(
			() => collectSvelteManifest(staleMod, 'src/routes', new Set()),
			/layout reset moved to `export const layout`/
		)
		const stalePlain = tmpRoutes({
			'+page.svelte': '<h1>home</h1>',
			'about@.svelte': '<h1>about</h1>',
		})
		assert.throws(
			() => collectSvelteManifest(stalePlain, 'src/routes', new Set()),
			/layout reset moved to `export const layout`/
		)
	})

	it('P1 items 6+12: csr=false + limits hints read from the sibling .ts', () => {
		const routesAbs = tmpRoutes({
			'plain.svelte': '<h1>p</h1>',
			'plain.ts': 'export const csr = false',
			'limited.svelte': '<h1>l</h1>',
			'limited.ts':
				'export const limits = { rate: 10, rateWindowMs: 60000, timeoutMs: 5000, bodyLimit: 1048576 }',
		})
		const { entries } = collectSvelteManifest(routesAbs, 'src/routes', new Set())
		const by = (svelte: string) => entries.find((e: SvelteRouteEntry) => e.svelte === svelte)
		assert.equal(by('plain.svelte')?.csr, false)
		assert.equal(by('limited.svelte')?.csr, true)
		assert.deepEqual(by('limited.svelte')?.limits, {
			rate: 10,
			rateWindowMs: 60000,
			timeoutMs: 5000,
			bodyLimit: 1048576,
		})
		assert.equal(by('plain.svelte')?.limits, null)
		assert.equal(readCsrFlag('export const csr = true'), true)
		assert.equal(readCsrFlag('export const x = 1'), true)
		assert.throws(
			() => assertLimitsHint('r/+page.ts', 'export const limits = { rate: "fast" }'),
			/bad limits hint/
		)
		assert.throws(
			() => assertLimitsHint('r/+page.ts', 'export const limits = { rate: 0 }'),
			/must be a positive int/
		)
	})
})
