import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { composeRenderJs, emitRenderJs, type SsrManifest } from './ssr.js'

function fixture(): { root: string; manifest: SsrManifest } {
	const root = mkdtempSync(join(tmpdir(), 'swelte-compose-'))
	const routes = join(root, 'src', 'routes')
	mkdirSync(join(routes, 'admin'), { recursive: true })
	writeFileSync(join(routes, '+page.svelte'), `<h1>home</h1>`)
	writeFileSync(join(routes, 'admin', '+page.svelte'), `<h1>admin</h1>`)
	writeFileSync(
		join(routes, 'admin', '+route.svelte'),
		`<script>let { children } = $props();</script><nav>NAV</nav><main>{@render children?.()}</main>`
	)
	writeFileSync(join(routes, '+error.svelte'), `<h1>oops</h1>`)
	const manifest: SsrManifest = {
		hasError: true,
		routes: [
			{ route: '/', svelte: '+page.svelte', kind: 'page', hasData: false },
			{ route: '/admin', svelte: 'admin/+page.svelte', kind: 'page', hasData: false },
		],
		error: '+error.svelte',
		wrappers: ['admin/+route.svelte'],
		wrappersByRoute: { './admin/+page.svelte': ['./admin/+route.svelte'] },
	}
	return { root, manifest }
}

describe('item 23 — full compose on tiny fixture', () => {
	it('compose output has renderRoute + route table + ssr marker, no node: strings', async () => {
		const { root, manifest } = fixture()
		const code = await composeRenderJs(manifest, { root })
		assert.ok(code.includes('renderRoute'))
		assert.ok(code.includes('"/":'))
		assert.ok(code.includes('"/admin":'))
		assert.ok(code.includes('data-swelte-ssr'))
		assert.ok(!code.includes('node:'))
		// No build-machine absolutes leak into the bundle.
		assert.ok(!code.includes(root))
	})

	it('composed bundle actually renders both routes + error fallback', async () => {
		const { root, manifest } = fixture()
		const code = await composeRenderJs(manifest, { root })
		const file = join(root, 'render.check.mjs')
		writeFileSync(file, code)
		const mod = (await import(pathToFileURL(file).href)) as {
			renderRoute: (route: string, props: string) => { head: string; body: string }
		}
		const home = mod.renderRoute('/', '{}')
		assert.ok(home.body.includes('data-swelte-ssr="1"'))
		assert.ok(home.body.includes('home'))
		const admin = mod.renderRoute('/admin', '{}')
		assert.ok(admin.body.includes('admin'))
		// Wrapper composes server-side: nav chrome surrounds the page.
		assert.ok(admin.body.includes('NAV'), admin.body.slice(0, 400))
		// Unknown route falls back to the global +error render.
		const nope = mod.renderRoute('/nope', '{}')
		assert.ok(nope.body.includes('oops'))
	})

	it('script-less +route.svelte is a build error (no children outlet)', async () => {
		const { root, manifest } = fixture()
		const { writeFileSync: w } = await import('node:fs')
		w(join(root, 'src', 'routes', 'admin', '+route.svelte'), '<nav>NAV</nav>')
		await assert.rejects(
			() => composeRenderJs(manifest, { root }),
			/must declare children via \$props/
		)
	})

	it('emitRenderJs prod cleans dist/ssr/ to exactly one file', async () => {
		const { root, manifest } = fixture()
		mkdirSync(join(root, 'dist', 'ssr'), { recursive: true })
		writeFileSync(join(root, 'dist', 'ssr', 'stale.js'), '// stale')
		const out = await emitRenderJs(manifest, { root, prod: true })
		assert.equal(out, join(root, 'dist', 'ssr', 'render.js'))
		assert.deepEqual(readdirSync(join(root, 'dist', 'ssr')), ['render.js'])
		assert.ok(readFileSync(out, 'utf8').includes('renderRoute'))
	})
})
