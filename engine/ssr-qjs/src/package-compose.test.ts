import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { composeRenderJs, type SsrManifest } from './ssr.js'

const manifest: SsrManifest = {
	hasError: false,
	routes: [{ route: '/', svelte: '+page.svelte', kind: 'page', hasData: false }],
	error: null,
	wrappers: [],
	wrappersByRoute: {},
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'swelte-package-compose-'))
	const put = (name: string, source: string) => {
		const file = join(root, name)
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(file, source)
	}
	put('package.json', '{"type":"module"}')
	put(
		'src/routes/+page.svelte',
		'<script>import Panel from "@dogfood/ui/Panel.svelte";</script><Panel />'
	)
	put(
		'node_modules/@dogfood/ui/package.json',
		JSON.stringify({
			name: '@dogfood/ui',
			type: 'module',
			exports: { './Panel.svelte': { svelte: './Panel.svelte' } },
		})
	)
	return { root, put }
}

it('bundles installed Svelte-only exports, nested components, TS and runes modules', async (t) => {
	const { root, put } = fixture()
	t.after(() => rmSync(root, { recursive: true, force: true }))
	put(
		'node_modules/@dogfood/ui/Panel.svelte',
		`<script lang="ts">
		import Detail from './Detail.svelte';
		import { View } from './view.svelte.js';
		import { label } from './label.js';
		const view = new View();
	</script><Detail message={label + view.message} />`
	)
	put(
		'node_modules/@dogfood/ui/Detail.svelte',
		'<script lang="ts">let { message }: { message: string } = $props();</script><h1>{message}</h1>'
	)
	put(
		'node_modules/@dogfood/ui/view.svelte.ts',
		'export class View { message: string = $state("native"); }'
	)
	put('node_modules/@dogfood/ui/label.ts', 'export const label: string = "installed:";')
	const code = await composeRenderJs(manifest, { root })
	assert.doesNotMatch(code, /from ['"]@dogfood/)
	assert.ok(!code.includes(root), 'build-machine paths must not leak into the bundle')
	put('render.mjs', code)
	const { renderRoute } = await import(pathToFileURL(join(root, 'render.mjs')).href)
	assert.match(renderRoute('/', '{}').body, /<h1>installed:native<\/h1>/)
})

it('fails composition for unresolved dependencies instead of emitting a QJS fallback bundle', async (t) => {
	const { root, put } = fixture()
	t.after(() => rmSync(root, { recursive: true, force: true }))
	put(
		'src/routes/+page.svelte',
		'<script>import missing from "swelte-dogfood-no-such-package";</script><p>{missing}</p>'
	)
	await assert.rejects(
		() => composeRenderJs(manifest, { root }),
		/unresolved SSR import.*swelte-dogfood-no-such-package/
	)
})

it('applies SSR source guards to components loaded from dependencies', async (t) => {
	const { root, put } = fixture()
	t.after(() => rmSync(root, { recursive: true, force: true }))
	put(
		'node_modules/@dogfood/ui/Panel.svelte',
		'<script>fetch("/provider");</script><p>invalid setup</p>'
	)
	await assert.rejects(() => composeRenderJs(manifest, { root }), /top-level fetch/)
})
