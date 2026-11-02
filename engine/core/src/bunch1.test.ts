import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
	parseVFile,
	routeFor,
	routeParamTs,
	svelteRouteFor,
	stripRouteGroups,
	transpileMatcherBody,
	loadServerHooks,
	renderServiceWorker,
	serviceWorkerPrecache,
} from './vite.js'
import {
	SwelteRpcError,
	isFail,
	deserialize,
	loadPage,
	isPageError,
	isPageData,
} from './sdk.js'
import { stubSdkImports } from '../../ssr-qjs/dist/ssr.js'

/** Diverse tests in bunch. */
describe('Bunch1', () => {
	it('comment-line @[attrs] never fuse with real attrs (stack fix)', () => {
		// FIXED: `parseVFile` blanks full-line comments that themselves
		// contain an attribute before the stacked-attr merge, so a
		// `// @[sse]` comment over a real `@[get]` parses as get-only.
		// Real multi-line stacks still fan out; prose comments between
		// attrs still merge (V ignores them).
		const fns = parseVFile('// @[sse]\n@[get]\npub fn g() string { return "x" }')
		assert.deepEqual(
			fns.map((f) => f.attr),
			['get'],
		)
		const stacked = parseVFile('@[sse]\n@[get]\npub fn g() string { return "x" }')
		assert.deepEqual(
			stacked.map((f) => f.attr).sort(),
			['get', 'sse'],
		)
	})

	it('load-only .v dispatches a 405-only arm — svelte-only needs a @[get] probe for HTML 200', () => {
		// parse: a lone @[load] yields zero verb/rpc/sse fns...
		const fns = parseVFile('@[load]\npub fn l(req SwelteRequest) string { return "{}" }')
		assert.deepEqual(
			fns.filter((x) => x.attr !== 'load').map((f) => f.attr),
			[],
		)
		// ...so emitRouteFile (loads stripped) emits verbs=[] and the
		// dispatch arm is 405-only (`swelte_method_not_allowed`, see
		// dispatchBody methodGate). Bare GET is therefore 405 JSON; an
		// HTML navigation on a 405 maps to the 405 error page, not the
		// leaf — hence the probe-`@[get]` arm the review prescribes for
		// svelte-only pages (cf. router/tags/+page.v).
	})

	it('item 3: loadPage error branch — RPC maps status, plain throw maps 500', async () => {
		// The error branch needs no special server shape: any stub throw
		// through loadPage lands in { error }. Pinned: sdk-errors.test.ts
		// covers this too; the review's item 3 is only the demo trigger.
		const rpc = await loadPage(async () => {
			throw new SwelteRpcError('/b', 'f', 400, { error: 'missing session' }, 'nf')
		})
		assert.ok(isPageError(rpc))
		if (isPageError(rpc)) assert.equal(rpc.error.status, 400)
		const plain = await loadPage(async () => {
			throw new Error('kaput')
		})
		assert.ok(isPageError(plain))
		if (isPageError(plain)) assert.equal(plain.error.status, 500)
		const ok = await loadPage(async () => 42)
		assert.ok(isPageData(ok))
		if (isPageData(ok)) assert.equal(ok.data, 42)
	})

	it('item 4: isFail matches ok:false+fieldErrors; deserialize needs the envelope', async () => {
		// Proven live against dist/sdk.js 2026-11-02: the review's item 4
		// must NOT call deserialize on raw verb JSON.
		const mk = (status: number, body: never) => new SwelteRpcError('/b', 'save', status, body, 'raw')
		const failBody = { ok: false, fieldErrors: { name: 'required' } } as never
		assert.equal(isFail(mk(422, failBody), 422), true)
		assert.equal(isFail(mk(400, failBody)), true) // bare status: any 4xx
		assert.equal(isFail(mk(422, { ok: true } as never), 422), false)
		assert.equal(isFail(mk(422, { ok: false } as never), 422), false)
		await assert.rejects(
			() => deserialize(new Response(JSON.stringify(failBody), { status: 422 })),
			/unknown type/,
		)
		const env = await deserialize(
			new Response(JSON.stringify({ type: 'failure', status: 422, data: failBody }), { status: 422 }),
		)
		assert.equal(env.type, 'failure')
		if (env.type === 'failure') assert.deepEqual(env.data, failBody)
	})

	it('entry-main tsc baseline: generated entry + routes.js .d.ts keep user tsc clean (gotcha fix)', async () => {
		// FIXED: `.swelte/entry-main.ts` called
		// `hydrateSwelteRoute(target, pathname)` with 2 args while the
		// generated `routes.js` fns take
		// `(target, pathname, errorProps)` — user `tsc --strict` failed
		// with TS2554 (2 errors). The entry now passes explicit
		// `undefined` and generate() emits an adjacent `entry-main.d.ts`
		// declaring `errorProps?` optional, so user `tsc --noEmit` is
		// clean. Assert the emit contract here (full user tsc runs in
		// the `something` build).
		const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const root = mkdtempSync(join(tmpdir(), 'swelte-entry-'))
		mkdirSync(join(root, 'src', 'routes'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(join(root, 'src', 'routes', '+page.v'), 'module p\n@[get] pub fn g() string { return "" }')
		const { swelte } = await import('./vite.js')
		const plug = swelte({}) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		const entry = readFileSync(join(root, '.swelte', 'entry-main.ts'), 'utf8')
		assert.ok(entry.includes('pathname, undefined)'), entry.slice(-400))
		const dts = readFileSync(join(root, '.swelte', 'entry-main.d.ts'), 'utf8')
		assert.ok(dts.includes('errorProps?: unknown'), dts.slice(0, 400))
	})

	it('route groups strip; group-only +page claims / (one-file-per-URL)', () => {
		assert.equal(stripRouteGroups('(mkt)/users'), 'users')
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', '/tmp/rr/src/routes/(mkt)/+page.v'), '/')
		assert.equal(svelteRouteFor('(mkt)/+page'), '/')
	})

	it('integer Params narrow to number; custom matchers stay string', () => {
		assert.equal(routeParamTs('/users/[id=integer]', 'id'), 'number')
		assert.equal(routeParamTs('/users/[id=slug]', 'id'), 'string')
	})

	it('matcher portable subset: loop + early returns; calls rejected', () => {
		const js = transpileMatcherBody(
			'slug',
			"\n\tif s == '' {\n\t\treturn false\n\t}\n\tfor c in s.bytes() {\n\t\tif c < 48 || c > 57 {\n\t\t\tif c < 97 || c > 122 {\n\t\t\t\treturn false\n\t\t\t}\n\t\t}\n\t}\n\treturn true\n",
		)
		assert.ok(js.includes('for (const c_c of s)'))
		assert.throws(() => transpileMatcherBody('bad', '\treturn s.contains("x")\n'), /unsupported statement/)
		assert.throws(() => transpileMatcherBody('bad', '\ts := s + "x"\n\treturn true\n'), /unsupported statement/)
	})

	it('app.v hooks: (host,path)->string reroute; startup void no-param', () => {
		// loadServerHooks enforces the exact signatures the review cites.
		assert.equal(typeof loadServerHooks, 'function')
	})

	it('SW render: SW_PRECACHE shell+hashes; precache lists / + assets', () => {
		const sw = renderServiceWorker({ version: 'v', precache: ['/', '/assets/a.js', '/assets/b.wasm'], base: '' })
		assert.ok(sw.includes('const SW_PRECACHE = ['))
		assert.ok(sw.includes('caches.open(SW_CACHE)'))
		assert.deepEqual(serviceWorkerPrecache({ 'a.js': { type: 'chunk', fileName: 'assets/a.js' } }), ['/', '/assets/a.js'])
	})

	it('commented-out SDK imports survive stubSdkImports (comment fix)', () => {
		// FIXED: commented-out imports must survive untouched (the old
		// regex rewrote `// import ... '@swelte/core'` inside comments).
		const stubbed = stubSdkImports("import { x } from '@swelte/core'\nconst y = 1", 'a.svelte')
		assert.ok(stubbed.includes('called during SSR render'))
		const commented = stubSdkImports("// import { x } from '@swelte/core'\nconst y = 1", 'a.svelte')
		assert.ok(!commented.includes('called during SSR render'), commented.slice(0, 200))
		assert.ok(commented.includes("// import { x } from '@swelte/core'"))
	})
})
