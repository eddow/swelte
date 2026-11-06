import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	assertNoNodeExternals,
	assertNoSdkTopLevelCalls,
	assertNoTopLevelStubCalls,
	assertQjsCompatible,
	assertUniversalLoadSync,
	compileSsrComponent,
	composeRenderJs,
	readUniversalSsrFlag,
	stubSdkImports,
	transpileSiblingLoad,
} from './ssr.js'

describe('item 17 — QJS-compat guards (file+line)', () => {
	it('top-level fetch( rejected with file:line; handler fetch allowed', () => {
		assert.throws(
			() => assertQjsCompatible('a.svelte', '<script>fetch("/x")</script>'),
			/a\.svelte:1/
		)
		assert.doesNotThrow(() =>
			assertQjsCompatible('b.svelte', '<script>function go(){ fetch("/x") }</script>')
		)
		assert.doesNotThrow(() =>
			assertQjsCompatible('c.svelte', '<button onclick={() => fetch("/x")}>x</button>')
		)
	})

	it('top-level await rejected in .svelte; await inside async fn allowed', () => {
		assert.throws(
			() => assertQjsCompatible('a.svelte', '<script>await foo()</script>'),
			/a\.svelte:1/
		)
		assert.doesNotThrow(() =>
			assertQjsCompatible('b.svelte', '<script>async function f(){ await foo() }</script>')
		)
	})

	it('node: imports/requires/dynamic-import rejected; comment string is fine', () => {
		// Note: assertQjsCompatible strips string bodies, so every `node:`
		// literal form (import/require/dynamic) is blanked before its
		// regexes run — the bundle backstop assertNoNodeExternals
		// (keepStrings=true) is the signal that fires. compileSsrComponent
		// itself does NOT call it per-file: `node:` inside .svelte reaches
		// the Rollup bundle, where bundleSsr's assertNoNodeExternals rejects
		// it. Both stay green on plain code.
		assert.throws(() => assertNoNodeExternals('f.js', `import x from 'node:fs'`))
		assert.throws(() => assertNoNodeExternals('f.js', `const x = require('node:fs')`))
		assert.throws(() => assertNoNodeExternals('f.js', `await import('node:fs')`))
		assert.doesNotThrow(() => assertQjsCompatible('f.js', `const a = 1`))
		assert.doesNotThrow(() => assertNoNodeExternals('f.js', `const a = 1`))
		// Commented-out import stays allowed (strip runs first).
		assert.doesNotThrow(() =>
			assertNoNodeExternals('f.js', `// import x from 'node:fs'\nconst a = 1`)
		)
	})

	it('top-level SDK stub call rejected, onclick call passes, alias tracked', async () => {
		const bad = `<script>import { greet } from '#routes/greet.v'; const r = greet({});</script><h1>x</h1>`
		await assert.rejects(
			() => assertNoTopLevelStubCalls('a', 'r', bad),
			/top-level stub call \(greet\)/
		)
		const ok = `<script>import { greet } from '#routes/greet.v';</script><button onclick={() => greet({})}>x</button>`
		await assert.doesNotReject(() => assertNoTopLevelStubCalls('a', 'r', ok))
		const aliased = `<script>import { greet as g } from '#routes/greet.v'; const r = g({});</script><h1>x</h1>`
		await assert.rejects(
			() => assertNoTopLevelStubCalls('a', 'r', aliased),
			/top-level stub call \(g\)/
		)
		// No SDK imports at all → no-op.
		await assert.doesNotReject(() => assertNoTopLevelStubCalls('a', 'r', '<h1>plain</h1>'))
	})

	it('$app/* calls: top-level goto/page rejected, onMount/handler calls pass', async () => {
		const bad = `<script>import { goto } from '$app/navigation'; goto('/x');</script><h1>x</h1>`
		await assert.rejects(
			() => assertNoSdkTopLevelCalls('a', 'r', bad),
			/top-level stub call \(goto\)/
		)
		const badStore = `<script>import { page } from '$app/stores'; const u = $page.url;</script><h1>x</h1>`
		// `$page` auto-subscription is a store read, not a stub call — allowed
		// at top level (the store import itself is dropped in the sync bundle,
		// so Svelte compiles it against the client bundle only when mounted).
		await assert.doesNotReject(() => assertNoSdkTopLevelCalls('a', 'r', badStore))
		const okMount = `<script>import { goto } from '$app/navigation'; import { onMount } from 'svelte'; onMount(() => goto('/x'));</script><h1>x</h1>`
		await assert.doesNotReject(() => assertNoSdkTopLevelCalls('a', 'r', okMount))
		const okHandler = `<script>import { goto } from '$app/navigation';</script><button onclick={() => goto('/x')}>x</button>`
		await assert.doesNotReject(() => assertNoSdkTopLevelCalls('a', 'r', okHandler))
		// Aliased import tracked by local name.
		const aliased = `<script>import { goto as g } from '$app/navigation'; g('/x');</script><h1>x</h1>`
		await assert.rejects(
			() => assertNoSdkTopLevelCalls('a', 'r', aliased),
			/top-level stub call \(g\)/
		)
		// Non-SDK calls never flagged.
		await assert.doesNotReject(() =>
			assertNoSdkTopLevelCalls('a', 'r', `<script>function go() {} go();</script><h1>x</h1>`)
		)
		// Plain `#lib/*.js` source is NOT a stub: same top-level call shape
		// passes (the SSR bundler resolves it from disk like the client).
		await assert.doesNotReject(() =>
			assertNoSdkTopLevelCalls(
				'a',
				'r',
				`<script>import { searchDocs } from '#lib/search.js'; let q = $state(''); let results = $derived(searchDocs(q));</script><h1>x</h1>`
			)
		)
		// `#lib/*.v` IS a stub: same call shape still fails.
		await assert.rejects(
			() =>
				assertNoSdkTopLevelCalls(
					'a',
					'r',
					`<script>import { h } from '#lib/crypto/hash.v'; const r = h({});</script><h1>x</h1>`
				),
			/top-level stub call \(h\)/
		)
	})
})

describe('item 18 — stubSdkImports rewrite + compileSsrComponent', () => {
	it('SDK imports become throw-stubs naming the file; others untouched', () => {
		const code = `import { greet } from '#routes/greet.v';\nimport { x } from './local.js';\n`
		const out = stubSdkImports(code, 'src/routes/+page.svelte')
		assert.ok(out.includes('greet() called during SSR render'))
		assert.ok(out.includes('src/routes/+page.svelte'))
		assert.ok(!out.includes('#routes/greet.v'))
		assert.ok(out.includes(`from './local.js'`))
	})

	it('$app/* client imports become throw-stubs (never in the sync bundle)', () => {
		const code = `import { goto, page } from '$app/navigation';\nimport { page as p } from '$app/stores';\nimport '$app/state';\n`
		const out = stubSdkImports(code, 'src/routes/router/+page.svelte')
		assert.ok(out.includes('goto() called during SSR render'))
		assert.ok(out.includes('page() called during SSR render'))
		assert.ok(!out.includes('$app/'))
	})

	it('aliased SDK names use the local name; import type not matched', () => {
		const code = `import { greet as g } from '#lib/util.v';\nimport type { T } from '#routes/x.v';\n`
		const out = stubSdkImports(code, 'f.svelte')
		assert.ok(out.includes('const g ='))
		// `import type` is a different statement form: untouched here
		// (the Svelte compiler erases it before this rewrite runs).
		assert.ok(out.includes('import type'))
		// Plain `#lib/*.js` source is NOT a stub: left for the resolver.
		const plain = `import { searchDocs } from '#lib/search.js';\n`
		assert.equal(stubSdkImports(plain, 'f.svelte'), plain)
	})

	it('compileSsrComponent: server output with SDK stubbed, guards applied', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-compile-'))
		const abs = join(dir, '+page.svelte')
		writeFileSync(
			abs,
			`<script>import { greet } from '#routes/greet.v'; let p = 1;</script><h1>{p}</h1>`
		)
		const js = await compileSsrComponent(abs, 'src/routes/+page.svelte')
		assert.ok(!js.includes('#routes/greet.v'))
		assert.ok(js.includes('called during SSR render'))
		// Pure component (no SDK) compiles and keeps its markup.
		const abs2 = join(dir, 'plain.svelte')
		writeFileSync(abs2, `<h1>hello</h1>`)
		const js2 = await compileSsrComponent(abs2, 'plain.svelte')
		assert.ok(js2.includes('hello'))
		// Guard fires before compile: top-level fetch never reaches svelte.
		const abs3 = join(dir, 'bad.svelte')
		writeFileSync(abs3, `<script>fetch("/x")</script><h1>x</h1>`)
		await assert.rejects(() => compileSsrComponent(abs3, 'bad.svelte'), /top-level fetch/)
	})
})

describe('universal load — sync subset (§1.1)', () => {
	it('sync load passes; async/fetch/SDK/await rejected when ssr=true', () => {
		assert.doesNotThrow(() =>
			assertUniversalLoadSync(
				'src/routes/admin.ts',
				`export function load({ params, props }) { return { title: String(props?.user ?? 'anon') } }`
			)
		)
		assert.throws(
			() =>
				assertUniversalLoadSync(
					'src/routes/admin.ts',
					`export async function load({ params }) { return { x: 1 } }`
				),
			/async load is forbidden/
		)
		assert.throws(
			() =>
				assertUniversalLoadSync(
					'src/routes/+page.ts',
					`export function load({ url }) { return fetch(url).then((r) => r.text()) }`
				),
			/top-level fetch|fetch\(\) is forbidden/
		)
		assert.throws(
			() =>
				assertUniversalLoadSync(
					'src/routes/admin.ts',
					`import { admin_whoami } from '#routes/admin/+page.v';\nexport function load({ props }) { return { x: 1 } }`
				),
			/SDK import/
		)
	})

	it('async load allowed when ssr=false (client-only)', () => {
		assert.doesNotThrow(() =>
			assertUniversalLoadSync(
				'src/routes/admin.ts',
				`export async function load({ params }) { const r = await fetch('/api/x'); return { x: 1 } }`,
				{ ssr: false }
			)
		)
	})

	it('non-load .ts is a no-op', () => {
		assert.doesNotThrow(() => assertUniversalLoadSync('src/routes/util.ts', `export const x = 1`))
	})

	it('export const ssr flag (ssr-qjs owned): absent/true = sync, false = async-ok', () => {
		assert.equal(readUniversalSsrFlag(`export function load() { return {} }`), true)
		assert.equal(
			readUniversalSsrFlag(`export const ssr = true\nexport function load() { return {} }`),
			true
		)
		assert.equal(
			readUniversalSsrFlag(`export const ssr = false\nexport async function load() { return {} }`),
			false
		)
		assert.doesNotThrow(() =>
			assertUniversalLoadSync(
				'src/routes/admin.ts',
				`export const ssr = false\nexport async function load() { const r = await fetch('/api/x'); return { x: 1 } }`,
				{ ssr: readUniversalSsrFlag(`export const ssr = false`) }
			)
		)
		assert.throws(
			() =>
				assertUniversalLoadSync(
					'src/routes/admin.ts',
					`export const ssr = false\nexport async function load() { return { x: 1 } }`,
					{ ssr: true }
				),
			/async load is forbidden/
		)
	})

	it('ssr=false async load is excluded from the sync QJS bundle (client-only)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-nossr-'))
		const routesDir = join(dir, 'src', 'routes')
		const { mkdirSync } = await import('node:fs')
		mkdirSync(routesDir, { recursive: true })
		writeFileSync(
			join(routesDir, '+page.svelte'),
			`<script>let { title } = $props();</script><h1>{title ?? 'shell'}</h1>`
		)
		writeFileSync(
			join(routesDir, '+page.ts'),
			`export const ssr = false;\nexport async function load() { const r = await fetch('/api/x'); return { title: 'async' } }`
		)
		const code = await composeRenderJs(
			{
				hasError: false,
				routes: [
					{
						route: '/',
						svelte: '+page.svelte',
						kind: 'page',
						hasData: false,
						hasUniversalLoad: true,
					},
				],
				error: null,
				wrappers: [],
				wrappersByRoute: {},
			},
			{ root: dir }
		)
		// No load import, no LOADEDMODS entry, no fetch in the sync bundle.
		assert.ok(!/import \{ load as LOAD_/.test(code), 'async load must not be imported')
		const mods = code.slice(code.indexOf('const LOADEDMODS'))
		assert.ok(!/LOAD_\d/.test(mods.split('};')[0]), 'no LOADEDMODS entries')
		assert.ok(!/fetch\(/.test(code), 'no fetch leaks into the sync bundle')
	})

	it('composeRenderJs applies sync load before render', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-load-'))
		const routesDir = join(dir, 'src', 'routes')
		const { mkdirSync } = await import('node:fs')
		mkdirSync(routesDir, { recursive: true })
		writeFileSync(
			join(routesDir, '+page.svelte'),
			`<script>let { title } = $props();</script><h1>{title}</h1>`
		)
		writeFileSync(
			join(routesDir, '+page.ts'),
			`export function load({ props }) { return { title: 'from-load:' + String(props?.greet ?? '') } }`
		)
		const code = await composeRenderJs(
			{
				hasError: false,
				routes: [
					{
						route: '/',
						svelte: '+page.svelte',
						kind: 'page',
						hasData: false,
						hasUniversalLoad: true,
					},
				],
				error: null,
				wrappers: [],
				wrappersByRoute: {},
			},
			{ root: dir }
		)
		assert.ok(code.includes('applyUniversalLoad'), 'render bundle must apply the universal load')
		assert.ok(code.includes('LOADEDMODS'), 'render bundle must map loads by route')
		// End-to-end through the real bundle: universal load merges V props
		// into the rendered page (the §1.1 contract, not just code shape).
		const { pathToFileURL } = await import('node:url')
		const probeFile = join(dir, 'render.check.mjs')
		writeFileSync(probeFile, code)
		const mod = (await import(pathToFileURL(probeFile).href)) as unknown as {
			renderRoute: (route: string, props: string) => { head: string; body: string }
		}
		const out = mod.renderRoute('/', JSON.stringify({ greet: 'hi' }))
		assert.ok(
			out.body.includes('from-load:hi'),
			`sync load must merge V props, got: ${out.body.slice(0, 160)}`
		)
	})

	it('transpileSiblingLoad strips TS types (.ts sibling with annotations bundles as JS)', async () => {
		const js = await transpileSiblingLoad(
			'router/+page.ts',
			`export function load({ params, props, url }: { params: Record<string, string>; props: Record<string, unknown>; url: string }) { return { v: String(params.x ?? '') + url } }`
		)
		assert.ok(!/:\s*\{[^}]*params/.test(js), `types must be stripped, got: ${js.slice(0, 160)}`)
		assert.ok(/export function load/.test(js), 'load export must survive')
		// `.js` siblings pass through untouched (no TS transform).
		const plain = `export function load({ params }) { return { v: params.x } }`
		assert.equal(await transpileSiblingLoad('router/+page.js', plain), plain)
	})

	it('composeRenderJs bundles a TYPED .ts sibling (annotations never reach QJS)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-ts-sib-'))
		const routesDir = join(dir, 'src', 'routes')
		const { mkdirSync } = await import('node:fs')
		mkdirSync(routesDir, { recursive: true })
		writeFileSync(
			join(routesDir, '+page.svelte'),
			`<script>let { title } = $props();</script><h1>{title}</h1>`
		)
		writeFileSync(
			join(routesDir, '+page.ts'),
			`export function load({ props }: { props: Record<string, unknown> }): { title: string } { return { title: 'typed:' + String((props as { greet?: string }).greet ?? '') } }`
		)
		const code = await composeRenderJs(
			{
				hasError: false,
				routes: [
					{
						route: '/',
						svelte: '+page.svelte',
						kind: 'page',
						hasData: false,
						hasUniversalLoad: true,
					},
				],
				error: null,
				wrappers: [],
				wrappersByRoute: {},
			},
			{ root: dir }
		)
		assert.ok(code.includes('applyUniversalLoad'), 'typed sibling must still register')
		assert.ok(!/props:\s*Record</.test(code), 'no TS annotations leak into render.js')
		const { pathToFileURL } = await import('node:url')
		const probeFile = join(dir, 'render.check.mjs')
		writeFileSync(probeFile, code)
		const mod = (await import(pathToFileURL(probeFile).href)) as unknown as {
			renderRoute: (route: string, props: string) => { head: string; body: string }
		}
		const out = mod.renderRoute('/', JSON.stringify({ greet: 'yo' }))
		assert.ok(out.body.includes('typed:yo'), `typed load must run, got: ${out.body.slice(0, 160)}`)
	})

	it('composeRenderJs bundles a page importing $app/* (client-only stubs, no specifier leak)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-app-'))
		const routesDir = join(dir, 'src', 'routes')
		const { mkdirSync } = await import('node:fs')
		mkdirSync(routesDir, { recursive: true })
		writeFileSync(
			join(routesDir, '+page.svelte'),
			`<script>import { goto } from '$app/navigation'; let { title } = $props();</script><h1>{title}</h1><button onclick={() => goto('/x')}>x</button>`
		)
		const code = await composeRenderJs(
			{
				hasError: false,
				routes: [
					{
						route: '/',
						svelte: '+page.svelte',
						kind: 'page',
						hasData: false,
						hasUniversalLoad: false,
					},
				],
				error: null,
				wrappers: [],
				wrappersByRoute: {},
			},
			{ root: dir }
		)
		assert.ok(!code.includes('$app/'), 'no $app specifier may survive into render.js')
		// Unused client-only imports are tree-shaken (the stub fires when
		// a handler path keeps the binding alive); either way the sync
		// bundle can never touch the router at render time.
		const { pathToFileURL } = await import('node:url')
		const probeFile = join(dir, 'render.check.mjs')
		writeFileSync(probeFile, code)
		const mod = (await import(pathToFileURL(probeFile).href)) as unknown as {
			renderRoute: (route: string, props: string) => { head: string; body: string }
		}
		const out = mod.renderRoute('/', JSON.stringify({ title: 'app-ok' }))
		assert.ok(out.body.includes('app-ok'), `page must render, got: ${out.body.slice(0, 160)}`)
	})

	it('composeRenderJs bundles a page importing plain #lib/*.js source (no specifier leak)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-lib-'))
		const routesDir = join(dir, 'src', 'routes')
		const libDir = join(dir, 'src', 'lib')
		const { mkdirSync } = await import('node:fs')
		mkdirSync(routesDir, { recursive: true })
		mkdirSync(libDir, { recursive: true })
		writeFileSync(
			join(libDir, 'search.js'),
			`export function searchDocs(q) { return 'found:' + q; }`
		)
		writeFileSync(
			join(routesDir, '+page.svelte'),
			`<script>import { searchDocs } from '#lib/search.js'; let { title } = $props(); let out = searchDocs('x');</script><h1>{title} {out}</h1>`
		)
		const code = await composeRenderJs(
			{
				hasError: false,
				routes: [
					{
						route: '/',
						svelte: '+page.svelte',
						kind: 'page',
						hasData: false,
						hasUniversalLoad: false,
					},
				],
				error: null,
				wrappers: [],
				wrappersByRoute: {},
			},
			{ root: dir }
		)
		assert.ok(!code.includes('#lib/'), 'no #lib specifier may survive into render.js')
		assert.ok(code.includes('found:'), `lib source must be bundled, got: ${code.slice(0, 200)}`)
		const { pathToFileURL } = await import('node:url')
		const probeFile = join(dir, 'render.check.mjs')
		writeFileSync(probeFile, code)
		const mod = (await import(pathToFileURL(probeFile).href)) as unknown as {
			renderRoute: (route: string, props: string) => { head: string; body: string }
		}
		const out = mod.renderRoute('/', JSON.stringify({ title: 'lib-ok' }))
		assert.ok(
			out.body.includes('found:x'),
			`lib call must run in SSR, got: ${out.body.slice(0, 160)}`
		)
	})

	it('composeRenderJs: ungated onMount renders the shell (server noop, SvelteKit parity)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-onmount-'))
		const routesDir = join(dir, 'src', 'routes')
		const { mkdirSync } = await import('node:fs')
		mkdirSync(routesDir, { recursive: true })
		// NOTE: `beforeUpdate`/`afterUpdate` are legacy-only in runes mode
		// (Svelte rejects the import at compile time), so only `onMount`
		// is exercised here — the shim still covers all three for
		// legacy-mode components.
		writeFileSync(
			join(routesDir, '+page.svelte'),
			`<script>import { onMount } from 'svelte'; onMount(() => { console.log(1) }); let { title } = $props();</script><h1>{title}</h1>`
		)
		const code = await composeRenderJs(
			{
				hasError: false,
				routes: [
					{
						route: '/',
						svelte: '+page.svelte',
						kind: 'page',
						hasData: false,
						hasUniversalLoad: false,
					},
				],
				error: null,
				wrappers: [],
				wrappersByRoute: {},
			},
			{ root: dir }
		)
		// No throwing client lifecycle may survive into the sync bundle:
		// the `export *` re-export carries every other binding, the three
		// explicit named exports shadow it with server noops (tree-shaken
		// when unused, harmless when kept).
		assert.ok(
			!code.includes('lifecycle_outside_component'),
			'client lifecycle throw must not survive into render.js'
		)
		const { pathToFileURL } = await import('node:url')
		const probeFile = join(dir, 'render.check.mjs')
		writeFileSync(probeFile, code)
		const mod = (await import(pathToFileURL(probeFile).href)) as unknown as {
			renderRoute: (route: string, props: string) => { head: string; body: string }
		}
		const out = mod.renderRoute('/', JSON.stringify({ title: 'mount-ok' }))
		assert.ok(
			out.body.includes('mount-ok'),
			`ungated onMount page must render the shell, got: ${out.body.slice(0, 200)}`
		)
	})

	it('composeRenderJs: svelte/store|motion|transition|animate|reactivity subpaths resolve server-side', async () => {
		// Guarded matrix (spec acceptance): every subpath the resolver
		// serves must compose + render — or fail loudly at build time.
		// `svelte/store|reactivity` have client/server splits: sync SSR
		// takes the server variant (package `default` condition).
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-subpaths-'))
		const routesDir = join(dir, 'src', 'routes')
		const { mkdirSync } = await import('node:fs')
		mkdirSync(routesDir, { recursive: true })
		writeFileSync(
			join(routesDir, '+page.svelte'),
			`<script>import { writable } from 'svelte/store'; import { spring } from 'svelte/motion'; import { fade } from 'svelte/transition'; import { flip } from 'svelte/animate'; import { MediaQuery } from 'svelte/reactivity'; const w = writable(1); const s = spring(0); const f = fade; const fl = flip; const M = MediaQuery; let { title } = $props();</script><h1>{title}</h1>`
		)
		const code = await composeRenderJs(
			{
				hasError: false,
				routes: [
					{
						route: '/',
						svelte: '+page.svelte',
						kind: 'page',
						hasData: false,
						hasUniversalLoad: false,
					},
				],
				error: null,
				wrappers: [],
				wrappersByRoute: {},
			},
			{ root: dir }
		)
		assert.ok(!code.includes('node:'), 'no node: externals may leak into render.js')
		const { pathToFileURL } = await import('node:url')
		const probeFile = join(dir, 'render.check.mjs')
		writeFileSync(probeFile, code)
		const mod = (await import(pathToFileURL(probeFile).href)) as unknown as {
			renderRoute: (route: string, props: string) => { head: string; body: string }
		}
		const out = mod.renderRoute('/', JSON.stringify({ title: 'sub-ok' }))
		assert.ok(
			out.body.includes('sub-ok'),
			`subpath page must render, got: ${out.body.slice(0, 200)}`
		)
	})
})
