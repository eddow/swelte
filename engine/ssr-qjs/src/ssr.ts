// SSR compiler (adapter-owned: core never imports svelte/compiler).
// For each manifest route: compile the .svelte with `generate: 'server'`,
// stub SDK imports (#routes → props, loadPage → identity), bundle the
// route subtree with Rollup to a single IIFE. Tree-shaking drops the
// async branch (verified: no `node:` strings survive for sync components).
// Emits `dist/ssr/render.js` exporting
// `renderRoute(route, props_json) -> { head, body }`.
//
// Guards (build errors with file+line):
// - SDK imports (#routes/#lib, loadPage) in SSR-compiled components
// - `node:` externals in the final bundle
// - `fetch(` / top-level `await` (QJS-compat: pure-sync renderer)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface SsrComposeOptions {
	root: string
	outFile?: string
	dev?: boolean
	routesDir?: string
}

export interface SsrManifest {
	version: 1
	hasError: boolean
	routes: { route: string; svelte: string; kind: string; hasData: boolean }[]
	error: string | null
	wrappers: string[]
}

/** Build guard: node: externals, fetch, top-level await.
 * SDK *calls* at top level are checked separately (assertNoTopLevelStubCalls):
 * imports are fine; handler/lifecycle calls are fine. */
export function assertQjsCompatible(file: string, src: string): void {
	const lines = src.split('\n')
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (/\bfrom\s+['"]node:/.test(line) || /\brequire\s*\(\s*['"]node:/.test(line)) {
			throw new Error(
				`[swelte:ssr-qjs] ${file}:${i + 1}: node: externals are forbidden in SSR render.js (QJS has no node:)`
			)
		}
		if (/(^|[^A-Za-z0-9_$])fetch\s*\(/.test(line)) {
			throw new Error(
				`[swelte:ssr-qjs] ${file}:${i + 1}: fetch() is forbidden in SSR components (QuickJS-compat: JS stays pure-sync, load() lives in V)`
			)
		}
		if (/^await\s+/m.test(src)) {
			const idx = lines.findIndex((l) => /^await\s+/.test(l))
			throw new Error(
				`[swelte:ssr-qjs] ${file}:${idx + 1}: top-level await is forbidden in SSR render.js (QuickJS-compat: pure-sync renderer)`
			)
		}
	}
}

/** Compile one .svelte file with `generate: 'server'`. Returns ESM js.
 * SDK imports (#routes/#lib/@swelte/core stubs) are rewritten to
 * render-time throw-stubs: they must never fire during SSR (guard
 * enforces top-level), and if a handler path somehow renders, the throw
 * routes to +error instead of a bare-specifier crash. The client bundle
 * is separate (Vite builds the real app from source) — these stubs never
 * ship to the browser. */
export async function compileSsrComponent(absFile: string, relFile: string): Promise<string> {
	assertQjsCompatible(relFile, readFileSync(absFile, 'utf8'))
	await assertNoTopLevelStubCalls(absFile, relFile, readFileSync(absFile, 'utf8'))
	const { compile } = (await import('svelte/compiler')) as typeof import('svelte/compiler')
	const src = readFileSync(absFile, 'utf8')
	const out = compile(src, { generate: 'server', dev: false, filename: absFile })
	for (const w of out.warnings ?? []) {
		if (String(w.code ?? '').includes('a11y')) continue
		console.warn(`[swelte:ssr-qjs] ${relFile}: svelte ${w.code}: ${w.message}`)
	}
	return stubSdkImports(out.js.code, relFile)
}

/** Rewrite SDK stub imports to render-time throw-stubs.
 * `import { a, b } from '#routes/x.v'` → `const a = () => { throw ... }; ...`.
 * Type-only imports (`import type`) vanish already (erased by compile). */
function stubSdkImports(code: string, relFile: string): string {
	const out: string[] = []
	let last = 0
	const re = /import\s*\{([^}]*)\}\s*from\s*['"](#routes\/[^'"]*|#lib\/[^'"]*|@swelte\/core)['"]/g
	let m: RegExpExecArray | null
	while ((m = re.exec(code)) !== null) {
		out.push(code.slice(last, m.index))
		const defs: string[] = []
		for (const part of (m[1] as string).split(',')) {
			const bits = part.trim().split(/\s+as\s+/)
			const nm = (bits[bits.length - 1] as string).trim()
			if (!nm || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nm) || nm === 'type') continue
			defs.push(
				'const ' + nm + " = () => { throw new Error('[swelte:ssr-qjs] " + relFile + ': ' + nm + "() called during SSR render'); };"
			)
		}
		out.push(defs.join('\n'))
		last = m.index + m[0].length
	}
	out.push(code.slice(last))
	return out.join('')
}

/** Bundle compiled route modules + svelte runtime into one IIFE. */
export async function bundleSsr(modules: Map<string, string>, entry: string): Promise<string> {
	const { rollup } = (await import('rollup')) as typeof import('rollup')
	// svelte resolves from the adapter's own install (peer dep), falling
	// back to cwd — the fixture dir may not have node_modules.
	const { createRequire } = await import('node:module')
	const req = createRequire(import.meta.url)
	let svelteRoot = ''
	for (const cand of [
		req.resolve('svelte/package.json'),
		resolve('node_modules/svelte/package.json'),
	]) {
		try {
			svelteRoot = dirname(cand)
			break
		} catch {
			/* try next */
		}
	}
	if (!svelteRoot) throw new Error('[swelte:ssr-qjs] cannot resolve svelte (peer dep missing)')
	const plugin = {
		name: 'swelte-ssr-resolve',
		async resolveId(id: string, importer: string | undefined) {
			if (modules.has(id)) return id
			// QJS-safe substitutes (shims/): crypto + render-context carry
			// lazy `node:` imports that never fire on the sync path but
			// break qjsc as strings. Substituted at bundle time; upstream
			// files named in each shim header for upgrade review.
			// import.meta.url is dist/ssr.js in prod, src/ssr.ts in dev —
			// shims/ sits next to both (dist/../shims, src/../shims).
			const here = dirname(new URL(import.meta.url).pathname)
			const shimDir = existsSync(join(here, '..', 'shims'))
				? join(here, '..', 'shims')
				: join(here, 'shims')
			// Match the bare specifier, the raw relative id (./crypto.js +
			// importer), and the already-resolved absolute path.
			const resolved = importer && id.startsWith('.') ? join(dirname(importer), id) : id
			if (
				resolved.endsWith('/internal/server/crypto.js') ||
				id === 'svelte/internal/server/crypto.js'
			)
				return join(shimDir, 'svelte-crypto.js')
			if (
				resolved.endsWith('/internal/server/render-context.js') ||
				id === 'svelte/internal/server/render-context.js'
			)
				return join(shimDir, 'svelte-render-context.js')
			if (id.startsWith('svelte')) {
				const sub = id.replace(/^svelte\/?/, '')
				const base = join(svelteRoot, sub === '' ? 'src/index-client.js' : `src/${sub}`)
				const isFile = (p: string) => {
					try {
						return statSync(p).isFile()
					} catch {
						return false
					}
				}
				for (const cand of [`${base}.js`, join(base, 'index.js'), base]) {
					if (isFile(cand)) return cand
				}
				return null
			}
			// Bare runtime deps of svelte internals (clsx, esm-env, devalue):
			// resolve from the importing file's node_modules chain.
			// Prefer ESM entry (module/import condition) — CJS breaks IIFE.
			// (Rollup resolveId may return a Promise.)
			if (!id.startsWith('.') && !id.startsWith('/') && !modules.has(id) && importer) {
				try {
					const { createRequire: fresh } = await import('node:module')
					const resolved = fresh(importer).resolve(id)
					// resolved may be CJS main — try the ESM sibling first.
					const esm =
						resolved.replace(/\.js$/, '.mjs') !== resolved &&
						existsSync(resolved.replace(/\.js$/, '.mjs'))
							? resolved.replace(/\.js$/, '.mjs')
							: null
					if (esm) return esm
					return resolved
				} catch {
					return null
				}
			}
			if (id.startsWith('.') && importer) {
				const full = resolve(dirname(importer), id)
				for (const cand of [full, `${full}.js`]) {
					if (modules.has(cand)) return cand
					if (existsSync(cand)) return cand
				}
			}
			return null
		},
		load(id: string) {
			return modules.get(id) ?? null
		},
	}
	const bundle = await rollup({ input: entry, plugins: [plugin], onwarn() {} })
	const { output } = await bundle.generate({ format: 'esm' })
	await bundle.close()
	const code = output[0].code
	assertQjsCompatible('dist/ssr/render.js (bundle)', code)
	return code
}

/** Full pipeline: manifest → per-route compile → bundle → IIFE string. */
export async function composeRenderJs(
	manifest: SsrManifest,
	opts: SsrComposeOptions
): Promise<string> {
	const root = resolve(opts.root)
	const routesDir = opts.routesDir ?? 'src/routes'
	const modules = new Map<string, string>()

	const compileFile = async (rel: string): Promise<string> => {
		const abs = join(root, routesDir, rel)
		if (modules.has(abs)) return abs
		modules.set(abs, await compileSsrComponent(abs, `${routesDir}/${rel}`))
		return abs
	}

	for (const r of manifest.routes) await compileFile(r.svelte)
	for (const w of manifest.wrappers) await compileFile(w)
	if (manifest.error) await compileFile(manifest.error)

	const table = manifest.routes
		.map((r) => `  ${JSON.stringify(r.route)}: ${JSON.stringify(join(root, routesDir, r.svelte))},`)
		.join('\n')
	const entrySrc = `import { render } from 'svelte/internal/server';
${[...modules.keys()].map((abs, i) => `import C${i} from ${JSON.stringify(abs)};`).join('\n')}
const PAGES = {
${[...modules.keys()].map((abs, i) => `  ${JSON.stringify(abs)}: C${i},`).join('\n')}
};
const ROUTES = {
${table}
};
const ERROR = ${manifest.error ? JSON.stringify(join(root, routesDir, manifest.error)) : 'null'};
function run(Component, props) {
  const out = render(Component, { props });
  return { head: out.head, body: '<div data-swelte-ssr="1">' + out.body + '</div>' };
}
export function renderRoute(route, props_json) {
  let props = {};
  try { props = JSON.parse(props_json || '{}'); } catch (e) { props = {}; }
  const abs = ROUTES[route];
  if (abs && PAGES[abs]) {
    try { return run(PAGES[abs], props); } catch (e) { /* fall to +error */ }
  }
  if (ERROR && PAGES[ERROR]) {
    try { return run(PAGES[ERROR], { status: 500, message: 'render failed' }); }
    catch (e) { /* fall through */ }
  }
  return { head: '', body: '<!--swelte:ssr:' + route + '-->' };
}
`
	const entryAbs = join(root, '.swelte', 'ssr-entry.js')
	modules.set(entryAbs, entrySrc)
	return bundleSsr(modules, entryAbs)
}

/** Write `dist/ssr/render.js` (prod) or `.swelte/dev/render.js` (dev). */
export async function emitRenderJs(
	manifest: SsrManifest,
	opts: SsrComposeOptions & { prod: boolean }
): Promise<string> {
	const code = await composeRenderJs(manifest, opts)
	const outFile =
		opts.outFile ??
		join(resolve(opts.root), opts.prod ? 'dist/ssr/render.js' : '.swelte/dev/render.js')
	mkdirSync(dirname(outFile), { recursive: true })
	writeFileSync(outFile, code)
	return outFile
}

/** Collect stub names imported from SDK dirs (#routes/#lib, @swelte/core). */
function stubImportNames(src: string): Set<string> {
	const names = new Set<string>()
	const re =
		/import\s*\{([^}]*)\}\s*from\s*['\"](#routes\/[^'\"]*|#lib\/[^'\"]*|@swelte\/core)['\"]/g
	for (const m of src.matchAll(re)) {
		for (const part of m[1].split(',')) {
			const nm = part
				.trim()
				.split(/\s+as\s+/)
				.pop()
				?.trim()
			if (nm && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nm) && nm !== 'type') names.add(nm)
		}
	}
	return names
}

/** Reject top-level SDK stub calls (fetch during render).
 * Imports are fine; calls inside functions/handlers/lifecycle are fine.
 * A bare `stubName(...)` in component setup scope fires during SSR render
 * (fetch does not exist in QJS). Move load-time data into $props()/load();
 * keep the stub for onclick/onMount. Top-level `await` is already rejected
 * by the Svelte compiler itself (both modes, without experimental.async). */
export async function assertNoTopLevelStubCalls(a: string, r: string, s: string): Promise<void> {
	const stubs = stubImportNames(s)
	if (stubs.size === 0) return
	const { parse } = (await import('svelte/compiler')) as typeof import('svelte/compiler')
	let stmts: unknown[] = []
	try {
		const ast = parse(s, { filename: a }) as unknown as {
			instance?: { content: { body: unknown[] } }
		}
		stmts = ast.instance?.content?.body ?? []
	} catch {
		return
	}
	const hit = new Set<string>()
	const visit = (n: unknown, fn: boolean): void => {
		if (!n || typeof n !== 'object') return
		const o = n as Record<string, unknown>
		if (
			o.type === 'FunctionDeclaration' ||
			o.type === 'FunctionExpression' ||
			o.type === 'ArrowFunctionExpression'
		) {
			for (const v of Object.values(o)) {
				if (Array.isArray(v)) for (const c of v) visit(c, true)
				else visit(v, true)
			}
			return
		}
		if (!fn && o.type === 'CallExpression') {
			const c = o.callee as Record<string, unknown> | undefined
			if (
				c &&
				c.type === 'Identifier' &&
				typeof c.name === 'string' &&
				stubs.has(c.name as string)
			) {
				hit.add(c.name as string)
			}
		}
		for (const v of Object.values(o)) {
			if (Array.isArray(v)) for (const c of v) visit(c, fn)
			else if (v && typeof v === 'object' && (v as Record<string, unknown>).type) visit(v, fn)
		}
	}
	for (const st of stmts) visit(st, false)
	if (hit.size > 0) {
		throw new Error(
			'[swelte:ssr-qjs] ' +
				r +
				': top-level stub call (' +
				[...hit].join(', ') +
				'). Move load-time data into $props()/load(); keep the stub for onclick/onMount.'
		)
	}
}
