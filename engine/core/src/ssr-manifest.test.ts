import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	collectSvelteManifest,
	svelteRouteFor,
	siblingLoadSource,
	universalLoadKind,
	chunkKeyFor,
} from './vite.js'
import type { SvelteRouteEntry } from './vite.js'

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
	})
})
