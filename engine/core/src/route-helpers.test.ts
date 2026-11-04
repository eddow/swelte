import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
	loadMatchers,
	modulePath,
	routeFor,
	transpileMatcherBody,
	vFileSafe,
	vPrefix,
	svelteModKind,
	svelteRouteFor,
	stripRouteGroups,
	routeParams,
	routeParamTs,
	dynSegName,
	dynSegMatcher,
	jsFetchFor,
	collectPrerenderEntries,
} from './vite.js'

const R = (f: string) => join('/tmp/rr', 'src', 'routes', f)

describe('route helpers', () => {
	it('routeFor: leaf /x', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('greet.v')), '/greet')
	})

	it('routeFor: api/ keeps path (dispatch strips leaf)', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('api/greet.v')), '/api/greet')
	})

	it('routeFor: +page -> /, admin/+page -> /admin', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('+page.v')), '/')
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('admin/+page.v')), '/admin')
	})

	it('routeFor: dynamic [id] passes through; [...rest] leaf is a valid catch-all', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id].v')), '/users/[id]')
		// Bare catch-all leaf is allowed: /files/[...rest] with empty rest
		// on GET /files (fallback when no folder-root leaf claims /files).
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('files/[...rest].v')),
			'/files/[...rest]'
		)
	})

	it('routeFor: +route wrapper -> null; dynamic wrapper throws', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('+route.v')), null)
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('admin/+route.v')), null)
		assert.throws(
			() => routeFor('src/routes', '/tmp/rr/src/routes', R('[id]/+route.v')),
			/dynamic wrapper/
		)
	})

	it('modulePath strips .v with posix seps', () => {
		assert.equal(modulePath('/a/src/routes', '/a/src/routes/api/greet.v'), 'api/greet')
		assert.equal(modulePath('/a/src/routes', '/a/src/routes/+page.v'), '+page')
	})

	it('vPrefix + vFileSafe have no / collisions', () => {
		assert.equal(vPrefix('admin/+page'), 'swelte_admin__page_')
		assert.equal(vFileSafe('admin/+page'), 'admin__page')
		assert.ok(!vFileSafe('a/b').includes('/'))
		assert.ok(!vPrefix('a/b').includes('/'))
		// flat `_` mapping is lossy today (`a/b` vs `a_b` collide);
		// generate() guards the real clash (folder-root double-claim).
		assert.equal(vFileSafe('a/b'), vFileSafe('a_b'))
	})

	it('svelteModKind/svelteRouteFor kinds', () => {
		assert.equal(svelteModKind('admin/+page'), 'page')
		assert.equal(svelteModKind('admin/+route'), 'wrapper')
		assert.equal(svelteModKind('+error'), 'error')
		assert.equal(svelteModKind('plain'), 'plain')
		assert.equal(svelteModKind('api/greet'), 'plain')
		assert.equal(svelteRouteFor('admin/+page'), '/admin')
		assert.equal(svelteRouteFor('+error'), null)
		// svelteRouteFor maps plain api mods to their URL; the null case is
		// the `+route` wrapper (folder router, no URL of its own).
		assert.equal(svelteRouteFor('api/greet'), '/api/greet')
		assert.equal(svelteRouteFor('admin/+route'), null)
	})

	it('roadmap §1.1 route groups strip from URL, keep on disk', () => {
		assert.equal(stripRouteGroups('(mkt)/users'), 'users')
		assert.equal(stripRouteGroups('(mkt)/(a)/users'), 'users')
		assert.equal(stripRouteGroups('admin/(mkt)/users'), 'admin/users')
		assert.equal(stripRouteGroups('users/[id]'), 'users/[id]')
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('(mkt)/users/+page.v')), '/users')
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('(mkt)/+page.v')), '/')
		assert.equal(svelteRouteFor('(mkt)/users/+page'), '/users')
		assert.equal(svelteRouteFor('(mkt)/+page'), '/')
	})

	it('roadmap §1.2 optional [[slug]] validates last-only, routes, params', () => {
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('docs/[[slug]].v')),
			'/docs/[[slug]]'
		)
		assert.deepEqual(routeParams('/docs/[[slug]]'), ['slug'])
		assert.deepEqual(routeParams('/users/[id]/posts/[[page]]'), ['id', 'page'])
		assert.throws(
			() => routeFor('src/routes', '/tmp/rr/src/routes', R('docs/[[a]]/x.v')),
			/optional param must be the last segment/
		)
	})

	it('§2.10 param matchers [id=integer]: validate, names, ts, url guard', () => {
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id=integer].v')),
			'/users/[id=integer]'
		)
		assert.deepEqual(routeParams('/users/[id=integer]'), ['id'])
		assert.equal(dynSegName('[id=integer]'), 'id')
		assert.equal(dynSegMatcher('[id=integer]'), 'integer')
		assert.equal(dynSegMatcher('[id]'), null)
		assert.equal(routeParamTs('/users/[id=integer]', 'id'), 'number')
		assert.equal(routeParamTs('/users/[id]', 'id'), 'string')
		assert.throws(
			() => routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id=nope].v')),
			/unknown matcher 'nope'/
		)
		assert.throws(
			() => routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id=integer]/[id].v')),
			/duplicate route param/
		)
		const stub = jsFetchFor('/users/[id=integer]', [], 'ignore')
		assert.ok(stub.includes('__swelteMatchers'), stub.slice(0, 500))
		assert.ok(stub.includes('does not match'), stub.slice(0, 2000))
	})

	it('custom matchers: transpile subset + loadMatchers validation', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-matchers-'))
		mkdirSync(join(root, 'src'), { recursive: true })
		// Transpile: loop + nested ifs + early returns.
		const js = transpileMatcherBody(
			'slug',
			"\n\tif s == '' {\n\t\treturn false\n\t}\n\tfor c in s.bytes() {\n\t\tif c < 48 || c > 57 {\n\t\t\tif c < 97 || c > 122 {\n\t\t\t\treturn false\n\t\t\t}\n\t\t}\n\t}\n\treturn true\n"
		)
		assert.ok(js.includes('for (const c_c of s)'), js.slice(0, 300))
		assert.ok(js.includes('charCodeAt(0)'), js)
		// Unsupported statement → build error naming the construct.
		assert.throws(
			() => transpileMatcherBody('bad', '\ts := s + \"x\"\n\treturn true\n'),
			/unsupported statement/
		)
		assert.throws(
			() => transpileMatcherBody('bad', '\treturn s.contains(\"x\")\n'),
			/unsupported statement/
		)
		// loadMatchers: shape errors.
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			'module m\n@[matcher]\npub fn bad(s string, t string) bool { return true }'
		)
		assert.throws(() => loadMatchers(root), /exactly one string param/)
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			'module m\n@[matcher]\npub fn bad(s string) !bool { return true }'
		)
		assert.throws(() => loadMatchers(root), /must return bool \(total/)
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			'module m\n@[matcher]\npub fn bad(s string) string { return s }'
		)
		assert.throws(() => loadMatchers(root), /must return bool/)
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			'import time\nmodule m\n@[matcher]\npub fn bad(s string) bool { return true }'
		)
		assert.throws(() => loadMatchers(root), /poisons WASM/)
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			'module m\n@[matcher]\npub fn a(s string) bool { return true }\n@[matcher]\npub fn a(s string) bool { return true }'
		)
		assert.throws(() => loadMatchers(root), /duplicate @\[matcher\] a/)
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			'module m\n@[matcher]\npub fn integer(s string) bool { return true }'
		)
		assert.throws(() => loadMatchers(root), /'integer' is builtin/)
		// Happy path: known set extends validation.
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			"module m\n@[matcher]\npub fn slug(s string) bool {\n\tif s == '' {\n\t\treturn false\n\t}\n\treturn true\n}"
		)
		const ms = loadMatchers(root)
		assert.ok(ms.has('slug') && ms.has('integer'))
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id=slug].v'), new Set(ms.keys())),
			'/users/[id=slug]'
		)
		// Custom matchers project string (only integer narrows to number).
		assert.equal(routeParamTs('/users/[id=slug]', 'id'), 'string')
		const stub = jsFetchFor('/users/[id=slug]', [], 'ignore', ms)
		assert.ok(stub.includes('slug: (s)'), stub.slice(0, 800))
		// Unknown still rejected even with a file present.
		assert.throws(
			() =>
				routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id=nope].v'), new Set(ms.keys())),
			/unknown matcher 'nope'/
		)
		// Item 7 regression: the prerender crawl (`collectPrerenderEntries`)
		// loads the same matcher set — a custom `[x=slug]` leaf must survive
		// crawl validation, not just direct routeFor (fixed 2026-11-02:
		// crawl called routeFor without the set, so every custom matcher
		// failed as `unknown matcher 'slug' (known: integer)` at build).
		mkdirSync(join(root, 'src', 'routes', 'posts'), { recursive: true })
		writeFileSync(
			join(root, 'src', 'routes', 'posts', '[slug=slug].v'),
			'module p\n@[get]\npub fn post_detail() string { return "" }'
		)
		const crawl = await collectPrerenderEntries(root, 'src/routes', 'static', new Set(ms.keys()))
		assert.ok(
			crawl.routes.includes('/posts/[slug=slug]') || crawl.dynamics.includes('/posts/[slug=slug]')
		)
	})

	it('roadmap §1.4 RouteId + Params types', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-params-'))
		mkdirSync(join(root, 'src', 'routes', 'users'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(
			join(root, 'src', 'routes', 'users', '[id].v'),
			'module u\n@[get] pub fn g(req SwelteRequest) string { return "x" }'
		)
		const { swelte } = await import('./vite.js')
		const plug = swelte({}) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		const dts = readFileSync(join(root, '.swelte', 'types', 'routes', 'users', '[id].d.ts'), 'utf8')
		assert.ok(dts.includes('export type RouteId = "/users/[id]"'), dts.slice(0, 400))
		assert.ok(dts.includes('export interface Params {'), dts.slice(0, 400))
		assert.ok(dts.includes('id: string'), dts.slice(0, 600))
	})

	it('roadmap §1.8 HEAD answers GET stubs (Allow on 405)', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-head-'))
		mkdirSync(join(root, 'src', 'routes'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(
			join(root, 'src', 'routes', '+page.v'),
			'module p\n@[get] pub fn g() string { return "hi" }'
		)
		const { swelte } = await import('./vite.js')
		const plug = swelte({}) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		const disp = readFileSync(join(root, '.swelte', 'routes', '_page.v'), 'utf8')
		assert.ok(disp.includes(`method == 'GET' || method == 'HEAD'`), disp.slice(0, 2000))
	})

	it('same-folder double catch-all is a build error (one per dir)', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-catch-'))
		mkdirSync(join(root, 'src', 'routes', 'files'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(
			join(root, 'src', 'routes', 'files', '[...a].v'),
			'module a\n@[get] pub fn g() string { return "" }'
		)
		writeFileSync(
			join(root, 'src', 'routes', 'files', '[...b].v'),
			'module b\n@[get] pub fn g() string { return "" }'
		)
		const { swelte } = await import('./vite.js')
		const plug = swelte({}) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await assert.rejects(async () => {
			await plug.buildStart?.()
		}, /same dynamic shape/)
	})

	it('§2.14 global middleware = root +route.v (no new file)', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-rootwrap-'))
		mkdirSync(join(root, 'src', 'routes', 'admin'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(
			join(root, 'src', 'routes', '+route.v'),
			'module r\n\n@[before]\npub fn guard(req SwelteRequest) !SwelteRequest {\n\treturn req\n}\n'
		)
		writeFileSync(
			join(root, 'src', 'routes', 'admin', '+page.v'),
			'module ap\n\n@[get]\npub fn g(req SwelteRequest) string {\n\treturn \"x\"\n}\n'
		)
		const { swelte } = await import('./vite.js')
		const plug = swelte({}) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await plug.buildStart?.()
		// Root wrapper chains into the nested leaf (global before-head).
		const disp = readFileSync(join(root, '.swelte', 'routes', 'admin__page.v'), 'utf8')
		assert.ok(disp.includes('swelte__route_guard(swelte_req)'), disp.slice(0, 3000))
	})

	it('folder-root double-claim throws in generate() (either extension)', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-claim-'))
		mkdirSync(join(root, 'src', 'routes', 'foo'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(
			join(root, 'src', 'routes', 'foo.v'),
			'module f\n@[get] pub fn g() string { return "" }'
		)
		writeFileSync(join(root, 'src', 'routes', 'foo', '+page.svelte'), '<h1>x</h1>')
		const { swelte } = await import('./vite.js')
		const plug = swelte({}) as unknown as {
			configResolved?: (c: { root: string }) => void
			buildStart?: () => Promise<void>
		}
		plug.configResolved?.({ root })
		await assert.rejects(async () => {
			await plug.buildStart?.()
		}, /claims the same URL/)
	})

	it('P0 item 1: readPrerenderHint parses true/false/auto/inherit; bad value throws', async () => {
		const { readPrerenderHint, assertPrerenderHint } = await import('./vite.js')
		assert.equal(readPrerenderHint('export const prerender = true'), 'prerender-true')
		assert.equal(readPrerenderHint('export const prerender = false'), 'prerender-false')
		assert.equal(readPrerenderHint("export const prerender = 'auto'"), 'prerender-auto')
		assert.equal(readPrerenderHint('export const x = 1'), 'inherit')
		assert.equal(
			assertPrerenderHint('r/+page.ts', 'export const prerender = true'),
			'prerender-true'
		)
		assert.throws(
			() => assertPrerenderHint('r/+page.ts', "export const prerender = 'sometimes'"),
			/bad prerender hint 'sometimes'/
		)
	})

	it('P0 item 1: partitionPrerender — false drops, true/auto include under off, inherit follows mode', async () => {
		const { partitionPrerender } = await import('./vite.js')
		const patterns = ['/', '/about', '/users/[id]']
		// Explicit flags beat the global mode both ways.
		const flags = new Map([
			['/about', 'prerender-false' as const],
			['/users/[id]', 'prerender-true' as const],
		])
		const off = partitionPrerender(patterns, flags, 'off')
		assert.ok(!off.routes.includes('/about'))
		assert.ok(!off.routes.includes('/'))
		assert.ok(off.dynamics.includes('/users/[id]'))
		const stat = partitionPrerender(patterns, new Map(), 'static')
		assert.ok(stat.routes.includes('/') && stat.routes.includes('/about'))
		// Under 'static' the dynamic pattern is listed (expansion to concrete
		// URLs happens only under 'all'); under 'off' inherit drops it.
		assert.ok(stat.dynamics.includes('/users/[id]'))
		const offClean = partitionPrerender(patterns, new Map(), 'off')
		assert.ok(!offClean.routes.includes('/') && !offClean.dynamics.includes('/users/[id]'))
	})

	it('P0 item 1: collectPrerenderEntries honors per-page prerender (leaf > global)', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-pre-'))
		mkdirSync(join(root, 'src', 'routes', 'about'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(join(root, 'src', 'routes', '+page.svelte'), '<h1>home</h1>')
		writeFileSync(join(root, 'src', 'routes', 'about', '+page.svelte'), '<h1>about</h1>')
		// Opt /about OUT even under a global static crawl.
		writeFileSync(
			join(root, 'src', 'routes', 'about', '+page.ts'),
			'export const prerender = false'
		)
		const crawl = await collectPrerenderEntries(root, 'src/routes', 'static', new Set(['integer']))
		assert.ok(crawl.routes.includes('/'), JSON.stringify(crawl))
		assert.ok(!crawl.routes.includes('/about'), JSON.stringify(crawl))
		// Opt-in under 'off': a true flag includes the route anyway.
		writeFileSync(join(root, 'src', 'routes', '+page.ts'), 'export const prerender = true')
		const crawlOff = await collectPrerenderEntries(root, 'src/routes', 'off', new Set(['integer']))
		assert.ok(crawlOff.routes.includes('/'), JSON.stringify(crawlOff))
		assert.ok(!crawlOff.routes.includes('/about'), JSON.stringify(crawlOff))
	})

	it('P0 item 1: wrapper +route.ts prerender=false excludes the subtree', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-prewrap-'))
		mkdirSync(join(root, 'src', 'routes', 'admin', 'users'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(join(root, 'src', 'routes', 'admin', '+route.svelte'), '<slot />')
		writeFileSync(
			join(root, 'src', 'routes', 'admin', '+route.ts') as string,
			'export const prerender = false'
		)
		writeFileSync(join(root, 'src', 'routes', 'admin', 'users', '+page.svelte'), '<h1>u</h1>')
		const crawl = await collectPrerenderEntries(root, 'src/routes', 'static', new Set(['integer']))
		assert.ok(!crawl.routes.includes('/admin/users'), JSON.stringify(crawl))
	})

	it('P2: collectPrerenderEntries awaits async entries() incl. paginated loops', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const root = mkdtempSync(join(tmpdir(), 'swelte-preasync-'))
		mkdirSync(join(root, 'src', 'routes', 'posts', '[slug]'), { recursive: true })
		mkdirSync(join(root, 'src', 'lib'), { recursive: true })
		writeFileSync(join(root, 'package.json'), '{"name":"t"}')
		writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
		writeFileSync(join(root, 'src', 'routes', 'posts', '[slug]', '+page.svelte'), '<h1>p</h1>')
		// Async entries with a paginated loop inside (SvelteKit `entries` can
		// be async and typically loops a fetch API; generate awaits it).
		writeFileSync(
			join(root, 'src', 'routes', 'posts', '[slug]', 'entries.ts'),
			`export async function entries() {
				const pages = [['hello'], ['world']];
				const out = [];
				for (const page of pages) {
					for (const slug of page) out.push({ slug });
				}
				return out;
			}`
		)
		const crawl = await collectPrerenderEntries(root, 'src/routes', 'all', new Set(['integer']))
		assert.ok(crawl.expanded.includes('/posts/hello'), JSON.stringify(crawl))
		assert.ok(crawl.expanded.includes('/posts/world'), JSON.stringify(crawl))
		// A Promise returned by mistake without awaiting would fail the old
		// shape check; a rejected async entries() surfaces file+line.
		writeFileSync(
			join(root, 'src', 'routes', 'posts', '[slug]', 'entries.ts'),
			`export async function entries() { throw new Error('boom'); }`
		)
		await assert.rejects(
			() => collectPrerenderEntries(root, 'src/routes', 'all', new Set(['integer'])),
			/entries\(\) threw/
		)
	})

	it('P0 items 2+3: emitLoadCascade wraps plain leaves, passes SwelteLoadResult through', async () => {
		const { emitLoadCascade } = await import('./vite/server-gen.js')
		const plain = emitLoadCascade('swelte_x_', [
			{
				mod: 'x/+page',
				file: 'f',
				name: 'load_x',
				attr: 'load',
				params: [],
				vret: 'X',
				tsret: 'X',
				fallible: true,
			},
		] as never)
		assert.ok(plain.includes('!SwelteLoadResult'), plain.slice(0, 400))
		assert.ok(plain.includes('SwelteLoadResult{ body: json.encode(frag_0) }'))
		const env = emitLoadCascade('swelte_x_', [
			{
				mod: 'x/+page',
				file: 'f',
				name: 'load_x',
				attr: 'load',
				params: [],
				vret: 'SwelteLoadResult',
				tsret: 'unknown',
				fallible: true,
			},
		] as never)
		assert.ok(env.includes('return frag_0'))
		assert.ok(!env.includes('json.encode(frag_0)'))
	})
})
