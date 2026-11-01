import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSvelteManifest, svelteRouteFor } from './vite.js'
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
})
