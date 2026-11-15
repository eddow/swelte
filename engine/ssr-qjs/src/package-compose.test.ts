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

it('keeps package-private #lib imports, directory entries and CommonJS dependencies local', async (t) => {
	const { root, put } = fixture()
	t.after(() => rmSync(root, { recursive: true, force: true }))
	put('src/lib/label.js', 'export const label = "WRONG HOST"')
	put(
		'node_modules/@dogfood/ui/package.json',
		JSON.stringify({
			name: '@dogfood/ui',
			type: 'module',
			exports: { './Panel.svelte': './Panel.svelte' },
			imports: { '#lib/*': './private/*' },
		})
	)
	put(
		'node_modules/@dogfood/ui/Panel.svelte',
		`<script>
		import { label } from '#lib/label.js';
		import { suffix } from './nested';
		import legacy from './legacy.cjs';
	</script><h1>{label}:{suffix}:{legacy()}</h1>`
	)
	put('node_modules/@dogfood/ui/private/label.js', 'export const label = "PACKAGE"')
	put('node_modules/@dogfood/ui/nested/index.js', 'export const suffix = "DIRECTORY"')
	put(
		'node_modules/@dogfood/ui/legacy.cjs',
		'module.exports = function () { return require("./value.cjs") }'
	)
	put('node_modules/@dogfood/ui/value.cjs', 'module.exports = "COMMONJS"')
	put('render.mjs', await composeRenderJs(manifest, { root }))
	const { renderRoute } = await import(pathToFileURL(join(root, 'render.mjs')).href)
	assert.match(renderRoute('/', '{}').body, /PACKAGE:DIRECTORY:COMMONJS/)
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

it('uses server lifecycle and marks render errors even without a global error component', async (t) => {
	const { root, put } = fixture()
	t.after(() => rmSync(root, { recursive: true, force: true }))
	put(
		'node_modules/@dogfood/ui/Panel.svelte',
		`<script>
		import { createContext, onDestroy } from 'svelte';
		const [get, set] = createContext(); set('server context'); const value = get();
		onDestroy(() => { globalThis.__dogfoodDestroyed = value; });
	</script><h1>server lifecycle</h1>`
	)
	put('render.mjs', await composeRenderJs(manifest, { root }))
	const good = await import(pathToFileURL(join(root, 'render.mjs')).href)
	assert.match(good.renderRoute('/', '{}').body, /server lifecycle/)
	assert.equal((globalThis as { __dogfoodDestroyed?: string }).__dogfoodDestroyed, 'server context')
	delete (globalThis as { __dogfoodDestroyed?: string }).__dogfoodDestroyed
	put('node_modules/@dogfood/ui/Panel.svelte', '<script>throw new Error("private cause")</script>')
	put('bad.mjs', await composeRenderJs(manifest, { root }))
	const bad = await import(pathToFileURL(join(root, 'bad.mjs')).href)
	const result = bad.renderRoute('/', '{}')
	assert.match(result.body, /data-swelte-render-error="1"/)
	assert.doesNotMatch(result.body, /private cause/)
})

it('bundles generated image metadata from a custom output directory', async (t) => {
	const { root, put } = fixture()
	t.after(() => rmSync(root, { recursive: true, force: true }))
	put('svelte.config.js', "export default { swelte: { outDir: '.generated' } }")
	put(
		'.generated/images.js',
		'export default { "photo.png": [{ src: "/base/images/photo-320.webp", width: 320, height: 160, format: "webp" }] }'
	)
	put(
		'src/routes/+page.svelte',
		'<script>import images from "#app/images";</script><img src={images["photo.png"][0].src} width={images["photo.png"][0].width} alt="Photo" />'
	)
	const code = await composeRenderJs(manifest, { root })
	put('render-images.mjs', code)
	const { renderRoute } = await import(pathToFileURL(join(root, 'render-images.mjs')).href)
	assert.match(renderRoute('/', '{}').body, /src="\/base\/images\/photo-320.webp" width="320"/)
})
