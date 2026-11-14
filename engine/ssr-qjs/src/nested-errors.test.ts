import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { collectErrorBoundaries, collectSvelteManifest } from '@swelte/core/vite'
import { composeRenderJs } from './ssr.js'

it('nested errors render with ancestor layouts, inherit through groups and fall back when broken', async () => {
	const root = mkdtempSync(join(tmpdir(), 'swelte-boundaries-'))
	const files = {
		'+route.svelte':
			'<script>let { children, data = {} } = $props()</script><nav>{data.locale}</nav>{@render children()}',
		'+error.svelte':
			'<script>let { status, message } = $props()</script><h1>root {status}: {message}</h1>',
		'admin/+error.svelte':
			'<script>let { status, message } = $props()</script><h1>admin {status}: {message}</h1>',
		'admin/+route.svelte':
			'<script>let { children } = $props(); throw new Error("broken layout")</script>{@render children?.()}',
		'admin/+page.svelte': '<h1>never rendered</h1>',
		'admin/deep/+error.svelte': '<script>throw new Error("broken boundary")</script>',
		'admin/deep/+page.svelte': '<script>throw new Error("broken page")</script>',
		'(private)/reports/+error.svelte': '<h1>group error</h1>',
		'(private)/reports/+page.svelte': '<script>throw new Error("private failure")</script>',
	}
	for (const [file, source] of Object.entries(files)) {
		const absolute = join(root, 'src/routes', file)
		mkdirSync(dirname(absolute), { recursive: true })
		writeFileSync(absolute, source)
	}
	const { entries, hasError } = collectSvelteManifest(
		join(root, 'src/routes'),
		'src/routes',
		new Set()
	)
	const errors = collectErrorBoundaries(entries)
	const code = await composeRenderJs(
		{
			hasError,
			error: '+error.svelte',
			errors,
			routes: entries.filter((entry) => entry.kind === 'page'),
			wrappers: entries.filter((entry) => entry.kind === 'wrapper').map((entry) => entry.svelte),
			wrappersByRoute: { './admin/+page.svelte': ['./+route.svelte', './admin/+route.svelte'] },
		},
		{ root }
	)
	const output = join(root, 'render.mjs')
	writeFileSync(output, code)
	const { renderRoute } = await import(pathToFileURL(output).href)
	const envelope = {
		version: 1,
		compat: true,
		url: 'http://localhost/admin',
		route: { pattern: '/admin' },
		data: {},
		levels: { '+route': { locale: 'fr' } },
		error: { status: 403, message: 'denied' },
	}
	const loaded = renderRoute('/+error', JSON.stringify(envelope)).body
	assert.match(loaded, /admin 403: denied/)
	assert.match(loaded, /<nav>fr<\/nav>/)
	assert.match(loaded, /data-swelte-error-boundary="admin%2F%2Berror.svelte"/)
	assert.doesNotMatch(loaded, /broken layout/)
	const broken = renderRoute('/admin/deep', '{}').body
	assert.match(broken, /admin 500: render failed/)
	assert.match(broken, /data-swelte-render-error="1"/)
	assert.doesNotMatch(broken, /broken boundary|broken page/)
	assert.match(renderRoute('/reports', '{}').body, /group error/)
	assert.match(
		renderRoute(
			'/+error',
			JSON.stringify({ status: 404, message: 'missing', path: '/admin/unknown' })
		).body,
		/admin 404: missing/
	)
	assert.match(renderRoute('/elsewhere', '{}').body, /root 404: not found/)
})
