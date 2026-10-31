// SSR compiler (adapter-owned: core never imports svelte/compiler).
// For each manifest route: compile the .svelte with `generate: 'server'`,
// stub SDK imports (#routes → props, loadPage → identity), bundle the
// route subtree with Rollup to a single ESM module. Tree-shaking drops the
// async branch (verified: no `node:` strings survive for sync components).
// Emits `dist/ssr/render.js` exporting
// `renderRoute(route, props_json) -> { head, body }`.
//
// Guards (build errors with file+line):
// - SDK imports (#routes/#lib, loadPage) in SSR-compiled components
// - `node:` externals in the final bundle (+ dynamic import)
// - top-level `fetch(` / top-level `await` in component sources
//   (QJS-compat: pure-sync renderer; fetch inside handlers is fine)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { posix } from 'node:path'

/** posix-normalize a relative import against a `./`-relative module key. */
function posixNormalize(fromKey: string, id: string): string {
	return posix.normalize(posix.join(posix.dirname(fromKey), id))
}

/** Re-prefix a normalized key with `./` (`+error.svelte` → `./+error.svelte`). */
function withDot(p: string): string {
	return p.startsWith('./') || p.startsWith('/') ? p : './' + p
}

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

/** Strip comments + string literals so the QJS-compat scan doesn't flag
 * `// fetch(` in a comment or `"fetch("` inside a template. Line numbers
 * are preserved (every char maps 1:1, newlines kept). With `keepStrings`
 * the contents of string literals survive (newlines inside them kept) —
 * used by assertNoNodeExternals, which looks *for* a string (`'node:…'`). */
function stripForScan(
	src: string,
	keepStrings = false
): { code: string; lineOf: (idx: number) => number } {
	const lineStarts: number[] = [0]
	for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1)
	const lineOf = (idx: number): number => {
		let lo = 0
		let hi = lineStarts.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1
			if (lineStarts[mid] <= idx) lo = mid
			else hi = mid - 1
		}
		return lo + 1
	}
	let out = ''
	let i = 0
	let quote: string | null = null
	while (i < src.length) {
		const c = src[i]
		const two = src.slice(i, i + 2)
		if (quote) {
			if (c === '\\') {
				out += keepStrings ? src.slice(i, i + 2) : '  '
				i += 2
				continue
			}
			if (c === quote) {
				quote = null
				out += keepStrings ? c : ' '
				i++
				continue
			}
			out += c === '\n' ? '\n' : keepStrings ? c : ' '
			i++
			continue
		}
		if (two === '//') {
			while (i < src.length && src[i] !== '\n') {
				out += ' '
				i++
			}
			continue
		}
		if (two === '/*') {
			while (i < src.length && src.slice(i, i + 2) !== '*/') {
				out += src[i] === '\n' ? '\n' : ' '
				i++
			}
			out += '  '
			i += 2
			continue
		}
		if (c === '"' || c === "'" || c === '`') {
			quote = c
			out += keepStrings ? c : ' '
			i++
			continue
		}
		out += c
		i++
	}
	return { code: out, lineOf }
}

/** Build guard: node: externals, top-level fetch, top-level await.
 * SDK *calls* at top level are checked separately (assertNoTopLevelStubCalls):
 * imports are fine; handler/lifecycle calls are fine. `fetch(` nested inside
 * a handler is allowed (it never runs during SSR) — only a top-level call
 * would fire during render, so only that is rejected here. */
export function assertQjsCompatible(file: string, src: string): void {
	const { code, lineOf } = stripForScan(src)
	const at = (idx: number) => `${file}:${lineOf(idx)}`
	for (const m of code.matchAll(/\bfrom\s+['"]node:/g)) {
		throw new Error(
			`[swelte:ssr-qjs] ${at(m.index ?? 0)}: node: externals are forbidden in SSR render.js (QJS has no node:)`
		)
	}
	for (const m of code.matchAll(/\brequire\s*\(\s*['"]node:/g)) {
		throw new Error(
			`[swelte:ssr-qjs] ${at(m.index ?? 0)}: node: externals are forbidden in SSR render.js (QJS has no node:)`
		)
	}
	for (const m of code.matchAll(/(^|[^A-Za-z0-9_$])fetch\s*\(/gm)) {
		if (isTopLevelCall(code, (m.index ?? 0) + m[0].length)) {
			throw new Error(
				`[swelte:ssr-qjs] ${at(m.index ?? 0)}: top-level fetch() is forbidden in SSR components (QuickJS-compat: JS stays pure-sync, load() lives in V; fetch inside handlers is fine)`
			)
		}
	}
	// Top-level await: only Svelte component sources are scanned for this
	// (bundle output is compiler-generated ESM — never has user TLA).
	if (file.endsWith('.svelte')) {
		for (const m of code.matchAll(/\bawait\s+/g)) {
			const idStart = m.index ?? 0
			if (isTopLevelAwait(code, idStart)) {
				throw new Error(
					`[swelte:ssr-qjs] ${at(idStart)}: top-level await is forbidden in SSR render.js (QuickJS-compat: pure-sync renderer)`
				)
			}
		}
	}
}

/** True when the `fetch` call ending at `callEnd` sits at module top level
 * (not nested in any function body). Assumes comments/strings stripped.
 * Backward brace walk from the call: `}`/`{` and `)`/`(` adjust depth.
 * A `{` that closes to depth 0 *before* reaching the statement start
 * means the call is inside a block — then check whether that block
 * belongs to a function/arrow (search the 200 chars before it for
 * `function`, `=>`, or ` class `). Plain `{ if… }` blocks without a
 * function opener still count as top-level (they run during SSR). */
function isTopLevelCall(code: string, callEnd: number): boolean {
	// Find enclosing block openers by walking back with depth.
	let depth = 0
	for (let j = callEnd - 1; j >= 0; j--) {
		const c = code[j]
		if (c === '}' || c === ')') depth++
		else if (c === '{' || c === '(') {
			if (depth > 0) {
				depth--
				continue
			}
			// depth 0 opener at j: does a function/arrow own this block?
			const before = code.slice(Math.max(0, j - 200), j)
			if (/\bfunction\b|=>|\bclass\b/.test(before.split(';').pop() ?? '')) return false
			// Plain block (if/for/bare): keep walking outward.
			continue
		} else if (c === ';' && depth === 0) {
			// Statement boundary without crossing a block: check the head.
			const head = code.slice(j + 1, callEnd)
			if (/\bfunction\b|\bclass\b/.test(head)) return false
			return !/=>/.test(head)
		}
		if (j === 0) {
			const head = code.slice(0, callEnd)
			if (/\bfunction\b|\bclass\b/.test(head)) return false
			return !/=>/.test(head)
		}
	}
	return true
}

/** True when `await` at `idx` is not inside a function body (module TLA).
 * Same backward-walk as isTopLevelCall: block openers checked for a
 * function/arrow owner, statement heads for `function`/`class`/`=>`. */
function isTopLevelAwait(code: string, idx: number): boolean {
	let depth = 0
	for (let j = idx - 1; j >= 0; j--) {
		const c = code[j]
		if (c === '}' || c === ')') depth++
		else if (c === '{' || c === '(') {
			if (depth > 0) {
				depth--
				continue
			}
			const before = code.slice(Math.max(0, j - 200), j)
			if (/\bfunction\b|=>|\bclass\b/.test(before.split(';').pop() ?? '')) return false
			continue
		} else if (c === ';' && depth === 0) {
			const head = code.slice(j + 1, idx)
			if (/\bfunction\b|\bclass\b/.test(head)) return false
			return !/=>/.test(head)
		}
		if (j === 0) {
			const head = code.slice(0, idx)
			if (/\bfunction\b|\bclass\b/.test(head)) return false
			return !/=>/.test(head)
		}
	}
	return true
}

/** node: externals only (bundle backstop; the full compat scan runs per
 * component source where handler-vs-setup scope is knowable). Also catches
 * dynamic `import("node:…")` that the source scan's static regexes miss. */
export function assertNoNodeExternals(file: string, src: string): void {
	// keepStrings: the specifier IS the signal — but comments still strip,
	// so `// import x from 'node:fs'` (commented out) stays allowed.
	const { code, lineOf } = stripForScan(src, true)
	const at = (idx: number) => `${file}:${lineOf(idx)}`
	for (const m of code.matchAll(/\bfrom\s+['"]node:/g)) {
		throw new Error(
			`[swelte:ssr-qjs] ${at(m.index ?? 0)}: node: externals are forbidden in SSR render.js (QJS has no node:)`
		)
	}
	for (const m of code.matchAll(/\brequire\s*\(\s*['"]node:/g)) {
		throw new Error(
			`[swelte:ssr-qjs] ${at(m.index ?? 0)}: node: externals are forbidden in SSR render.js (QJS has no node:)`
		)
	}
	for (const m of code.matchAll(/\bimport\s*\(\s*['"]node:/g)) {
		throw new Error(
			`[swelte:ssr-qjs] ${at(m.index ?? 0)}: node: externals are forbidden in SSR render.js (QJS has no node:)`
		)
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
				'const ' +
					nm +
					" = () => { throw new Error('[swelte:ssr-qjs] " +
					relFile +
					': ' +
					nm +
					"() called during SSR render'); };"
			)
		}
		out.push(defs.join('\n'))
		last = m.index + m[0].length
	}
	out.push(code.slice(last))
	return out.join('')
}

/** Bundle compiled route modules + svelte runtime into one ESM module. */
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
				for (const cand of [full, `${full}.js`, `${full}.svelte`]) {
					if (modules.has(cand)) return cand
					if (existsSync(cand)) return cand
				}
				// Compiled-module keys are `./`-relative posix paths, keyed
				// off the importer when it is one of them; the loader then
				// serves the compiled source (raw .svelte never hits disk).
				if (modules.has(importer)) {
					const { posix, sep: psep } = await import('node:path')
					const impDir = posix.dirname(importer)
					const norm = posix.normalize(posix.join(impDir, id))
					if (modules.has(norm)) return norm
					// OS-sep variant (windows importer form).
					const alt = norm.split(posix.sep).join(psep)
					if (modules.has(alt)) return alt
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
	// Bundle-level guard: node: externals only. fetch/top-level-await are
	// checked per-component-source (assertQjsCompatible runs in
	// compileSsrComponent) where handler-vs-setup scope is knowable;
	// the bundle is compiler-generated ESM and handler fetch() calls in
	// it are unreachable during SSR (only renderRoute runs).
	assertNoNodeExternals('dist/ssr/render.js (bundle)', code)
	return code
}

/** Full pipeline: manifest → per-route compile → bundle → ESM string.
 * Module keys are `./`-relative posix paths (no build-machine absolutes
 * leak into the bundle); the resolver maps them back to compiled sources. */
export async function composeRenderJs(
	manifest: SsrManifest,
	opts: SsrComposeOptions
): Promise<string> {
	const root = resolve(opts.root)
	const routesDir = opts.routesDir ?? 'src/routes'
	const modules = new Map<string, string>()

	const compileFile = async (rel: string): Promise<string> => {
		const abs = join(root, routesDir, rel)
		// Module keys are `./`-prefixed posix paths (`./+error.svelte`):
		// posixNormalize('./admin/+page.svelte', '../+error.svelte')
		// yields `+error.svelte` (no `./`), so re-prefix here.
		const key = './' + rel.split(sep).join('/').replace(/^\.\//, '')
		if (modules.has(key)) return key
		// Normalize nested relative imports to module keys at compile time:
		// `import ErrorPage from '../+error.svelte'` inside
		// `./admin/+page.svelte` must resolve to `./+error.svelte` (the key
		// form), not the raw relative id Rollup would hand the resolver.
		// Order matters: error + wrappers first so every forward reference
		// already has a key when a page is compiled.
		let code = await compileSsrComponent(abs, `${routesDir}/${rel}`)
		code = code.replace(/from\s*(['"])(\.[^'"]*)\1/g, (full, q: string, id: string) => {
			const norm = withDot(posixNormalize(key, id))
			if (modules.has(norm) || norm.endsWith('.svelte')) return `from ${q}${norm}${q}`
			return full
		})
		modules.set(key, code)
		return key
	}

	// Error page + wrappers first: pages import them relatively (`../+error`),
	// so their keys must exist before page sources are normalized above.
	if (manifest.error) await compileFile(manifest.error)
	for (const w of manifest.wrappers) await compileFile(w)
	for (const r of manifest.routes) await compileFile(r.svelte)

	const table = manifest.routes
		.map(
			(r) =>
				`  ${JSON.stringify(r.route)}: ${JSON.stringify(withDot(r.svelte.split('/').join('/')))},`
		)
		.join('\n')
	const entrySrc = `import { render } from 'svelte/internal/server';
${[...modules.keys()].map((key, i) => `import C${i} from ${JSON.stringify(key)};`).join('\n')}
const PAGES = {
${[...modules.keys()].map((key, i) => `  ${JSON.stringify(key)}: C${i},`).join('\n')}
};
const ROUTES = {
${table}
};
const ERROR = ${manifest.error ? JSON.stringify(withDot(manifest.error.split('/').join('/'))) : 'null'};
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
    try {
      const st = (props && typeof props.status === 'number') ? props.status : 500;
      const msg = (props && typeof props.message === 'string') ? props.message : 'render failed';
      return run(PAGES[ERROR], { status: st, message: msg });
    }
    catch (e) { /* fall through */ }
  }
  return { head: '', body: '<!--swelte:ssr:' + route + '-->' };
}
`
	const entryAbs = join(root, '.swelte', 'ssr-entry.js')
	modules.set(entryAbs, entrySrc)
	return bundleSsr(modules, entryAbs)
}

/** Write `dist/ssr/render.js` (prod) or `<outDir>/dev/render.js` (dev).
 * Cleans `dist/ssr/` first in prod so a stale second file can't trip the
 * single-artifact gate. */
export async function emitRenderJs(
	manifest: SsrManifest,
	opts: SsrComposeOptions & { prod: boolean }
): Promise<string> {
	const code = await composeRenderJs(manifest, opts)
	const root = resolve(opts.root)
	const defaultProd = join(root, 'dist/ssr/render.js')
	if (opts.prod && !opts.outFile) {
		try {
			const { rmSync, readdirSync } = await import('node:fs')
			for (const f of readdirSync(join(root, 'dist', 'ssr'))) {
				if (f !== 'render.js') rmSync(join(root, 'dist', 'ssr', f))
			}
		} catch {
			/* dist/ssr absent — mkdir below creates it */
		}
	}
	const outFile =
		opts.outFile ?? (opts.prod ? defaultProd : join(root, '.swelte', 'dev', 'render.js'))
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
