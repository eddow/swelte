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
} from './vite.js'

const R = (f: string) => join('/tmp/rr', 'src', 'routes', f)

describe('route helpers', () => {
	it('routeFor: leaf /x', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('greet.v')), '/greet')
	})

	it('routeFor: api/ keeps path (dispatch strips leaf)', () => {
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('api/greet.v')),
			'/api/greet'
		)
	})

	it('routeFor: +page -> /, admin/+page -> /admin', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('+page.v')), '/')
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('admin/+page.v')),
			'/admin'
		)
	})

	it('routeFor: dynamic [id] passes through; [...rest] leaf is a valid catch-all', () => {
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id].v')),
			'/users/[id]'
		)
		// Bare catch-all leaf is allowed: /files/[...rest] with empty rest
		// on GET /files (fallback when no folder-root leaf claims /files).
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('files/[...rest].v')),
			'/files/[...rest]'
		)
	})

	it('routeFor: +route wrapper -> null; dynamic wrapper throws', () => {
		assert.equal(routeFor('src/routes', '/tmp/rr/src/routes', R('+route.v')), null)
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('admin/+route.v')),
			null
		)
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
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('(mkt)/users/+page.v')),
			'/users'
		)
		assert.equal(
			routeFor('src/routes', '/tmp/rr/src/routes', R('(mkt)/+page.v')),
			'/'
		)
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
		assert.throws(() => transpileMatcherBody('bad', '\ts := s + \"x\"\n\treturn true\n'), /unsupported statement/)
		assert.throws(() => transpileMatcherBody('bad', '\treturn s.contains(\"x\")\n'), /unsupported statement/)
		// loadMatchers: shape errors.
		writeFileSync(join(root, 'src', 'matchers.v'), 'module m\n@[matcher]\npub fn bad(s string, t string) bool { return true }')
		assert.throws(() => loadMatchers(root), /exactly one string param/)
		writeFileSync(join(root, 'src', 'matchers.v'), 'module m\n@[matcher]\npub fn bad(s string) !bool { return true }')
		assert.throws(() => loadMatchers(root), /must return bool \(total/)
		writeFileSync(join(root, 'src', 'matchers.v'), 'module m\n@[matcher]\npub fn bad(s string) string { return s }')
		assert.throws(() => loadMatchers(root), /must return bool/)
		writeFileSync(join(root, 'src', 'matchers.v'), 'import time\nmodule m\n@[matcher]\npub fn bad(s string) bool { return true }')
		assert.throws(() => loadMatchers(root), /poisons WASM/)
		writeFileSync(
			join(root, 'src', 'matchers.v'),
			'module m\n@[matcher]\npub fn a(s string) bool { return true }\n@[matcher]\npub fn a(s string) bool { return true }'
		)
		assert.throws(() => loadMatchers(root), /duplicate @\[matcher\] a/)
		writeFileSync(join(root, 'src', 'matchers.v'), 'module m\n@[matcher]\npub fn integer(s string) bool { return true }')
		assert.throws(() => loadMatchers(root), /'integer' is builtin/)
		// Happy path: known set extends validation.
		writeFileSync(join(root, 'src', 'matchers.v'), 'module m\n@[matcher]\npub fn slug(s string) bool {\n\tif s == \'\' {\n\t\treturn false\n\t}\n\treturn true\n}')
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
			() => routeFor('src/routes', '/tmp/rr/src/routes', R('users/[id=nope].v'), new Set(ms.keys())),
			/unknown matcher 'nope'/
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
		writeFileSync(join(root, 'src', 'routes', 'files', '[...a].v'), 'module a\n@[get] pub fn g() string { return "" }')
		writeFileSync(join(root, 'src', 'routes', 'files', '[...b].v'), 'module b\n@[get] pub fn g() string { return "" }')
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
		writeFileSync(join(root, 'src', 'routes', 'foo.v'), 'module f\n@[get] pub fn g() string { return "" }')
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
})
