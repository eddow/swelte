import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
	assertQjsCompatible,
	assertNoNodeExternals,
	assertNoTopLevelStubCalls,
	stubSdkImports,
	compileSsrComponent,
} from './ssr.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('item 17 — QJS-compat guards (file+line)', () => {
	it('top-level fetch( rejected with file:line; handler fetch allowed', () => {
		assert.throws(() => assertQjsCompatible('a.svelte', '<script>fetch("/x")</script>'), /a\.svelte:1/)
		assert.doesNotThrow(() =>
			assertQjsCompatible('b.svelte', '<script>function go(){ fetch("/x") }</script>')
		)
		assert.doesNotThrow(() =>
			assertQjsCompatible('c.svelte', '<button onclick={() => fetch("/x")}>x</button>')
		)
	})

	it('top-level await rejected in .svelte; await inside async fn allowed', () => {
		assert.throws(() => assertQjsCompatible('a.svelte', '<script>await foo()</script>'), /a\.svelte:1/)
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
		assert.doesNotThrow(() => assertNoNodeExternals('f.js', `// import x from 'node:fs'\nconst a = 1`))
	})

	it('top-level SDK stub call rejected, onclick call passes, alias tracked', async () => {
		const bad = `<script>import { greet } from '#routes/greet.v'; const r = greet({});</script><h1>x</h1>`
		await assert.rejects(() => assertNoTopLevelStubCalls('a', 'r', bad), /top-level stub call \(greet\)/)
		const ok = `<script>import { greet } from '#routes/greet.v';</script><button onclick={() => greet({})}>x</button>`
		await assert.doesNotReject(() => assertNoTopLevelStubCalls('a', 'r', ok))
		const aliased = `<script>import { greet as g } from '#routes/greet.v'; const r = g({});</script><h1>x</h1>`
		await assert.rejects(() => assertNoTopLevelStubCalls('a', 'r', aliased), /top-level stub call \(g\)/)
		// No SDK imports at all → no-op.
		await assert.doesNotReject(() => assertNoTopLevelStubCalls('a', 'r', '<h1>plain</h1>'))
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

	it('aliased SDK names use the local name; import type not matched', () => {
		const code = `import { greet as g } from '#lib/util.v';\nimport type { T } from '#routes/x.v';\n`
		const out = stubSdkImports(code, 'f.svelte')
		assert.ok(out.includes('const g ='))
		// `import type` is a different statement form: untouched here
		// (the Svelte compiler erases it before this rewrite runs).
		assert.ok(out.includes('import type'))
	})

	it('compileSsrComponent: server output with SDK stubbed, guards applied', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'swelte-ssr-compile-'))
		const abs = join(dir, '+page.svelte')
		writeFileSync(abs, `<script>import { greet } from '#routes/greet.v'; let p = 1;</script><h1>{p}</h1>`)
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
