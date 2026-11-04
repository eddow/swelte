// `svelte.config.js` loading + `.swelte/` harness rendering.
// `svelte.config.js` is the single source of truth (typed as SvelteConfig
// + our `swelte` key); everything under `.swelte/` is derived.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import type { SvelteConfig as SvelteBaseConfig } from '@sveltejs/vite-plugin-svelte'

export interface SwelteOptions {
	name?: string
	routesDir?: string
	libDir?: string
	outDir?: string
	distDir?: string
	port?: number
	corsOrigin?: string
	/** URL trailing-slash policy: 'always' | 'never' | 'ignore' (default 'ignore' = today's behavior). */
	trailingSlash?: 'always' | 'never' | 'ignore'
	/** Base path for generated URLs (SvelteKit `paths.base` equivalent). Default ''. */
	base?: string
	/** Assets prefix for generated URLs (`paths.assets` equivalent). Defaults to base. */
	assets?: string
	/** Content-Security-Policy value; when set, transformIndexHtml injects the meta tag. */
	csp?: string
	/** CSRF origin check: 'ignore' (default) or 'enforce' (reject cross-origin mutating requests). */
	csrf?: 'ignore' | 'enforce'
	/** Honor `?_method=` override before verb dispatch. Default false. */
	methodOverride?: boolean
	/** App version stamp (SvelteKit `version` equivalent). Defaults to package.json version. */
	version?: string
	/** Opt-in service worker (SvelteKit `serviceWorker` lite). Default off.
	 *  `register?: 'auto' | 'manual'` — when enabled, `swelte build` emits
	 *  additive `dist/sw.js` (hand-rolled, no workbox dep) and injects a
	 *  same-origin registration snippet; `manual` emits the file but skips
	 *  the snippet so the app registers itself. Env `SWELTE_SW=1` forces on. */
	serviceWorker?: { enabled?: boolean; register?: 'auto' | 'manual' }
	/** Prerender/SSG crawl (SvelteKit `entries` + `prerender` lite). Default off.
	 *  `entries?: 'static' | 'all'` — `static` crawls only static routes
	 *  (no `[param]`), `all` also executes sibling `entries.ts` exports for
	 *  dynamic segments. `concurrency` bounds the crawl. Additive
	 *  `dist/*.html` only - runtime/SPA-first defaults never change. */
	prerender?: SweltePrerenderOptions
	/** ISR lite: `[path]: seconds` map stamping `Cache-Control:
	 *  public, max-age=0, s-maxage=N` + `X-Swelte-Revalidate` on matching
	 *  GET HTML responses. Additive headers only. */
	isr?: Record<string, number>
	/** Deploy-target shims (packaging only, no Node runtime). `static`
	 *  asserts no `dist/server` consumer is needed... (see normalize). */
	target?: 'auto' | 'static' | 'node' | 'edge'
	/** Client code-splitting: `'layout'` (default) emits one lazy chunk per
	 *  `+route.svelte` subtree (folder without a wrapper bubbles into the
	 *  parent chunk); `'single'` emits static imports (one JS + one CSS);
	 *  `'route'` emits one lazy chunk per leaf. CSS follows JS (`import()`
	 *  + `cssCodeSplit`); `src/app.css` stays in the entry; `+error` +
	 *  matcher table stay eager. Env `SWELTE_CHUNKING` wins. */
	chunking?: 'single' | 'layout' | 'route'
	/** Cross-build OS (`swelte build --target-os` fallback). `linux` |
	 *  `macos` | `windows` — passed as `-os <os>` to the `v -o` server
	 *  link. Unset = host-native. CLI flag wins, `SWELTE_TARGET_OS` env
	 *  middle, this config last. `build`-only: `dev`/`preview`/`test`
	 *  stay host-native. QJS projects cross only via the zig-cc wrapper
	 *  (per-OS-ARCH `libqjs-<os>-<arch>.a`); without it the build fails
	 *  fast instead of silently linking the wrong ABI.
	 *  WASM untouched: always `-os browser`. */
	targetOs?: 'linux' | 'macos' | 'windows' | string
	/** Cross-build arch (`swelte build --target-arch` fallback). `amd64` |
	 *  `arm64` (`x64`/`x86_64`/`aarch64` aliases accepted) — passed as
	 *  `-arch <arch>` to the `v -o` server link. Unset = host-native.
	 *  Same CLI > `SWELTE_TARGET_ARCH` env > config precedence as targetOs.
	 *  Declaring it lets `npm i` prep the machine: `@swelte/vvm`
	 *  postinstall downloads zig + writes the `zig-cc-<os>-<arch>`
	 *  wrapper `swelte build` uses as `-cc` for that target. */
	targetArch?: 'amd64' | 'arm64' | string
	/** Offline fallback page (opt-in service worker remainder): precached
	 *  `dist/offline.html` served by `sw.js` on navigation failure. */
	offline?: SwelteOfflineOptions
}

/** Back-compat alias: the `swelte` key payload. */
export type { SwelteOptions as SwelteConfigOptions }

/** Project config: standard Svelte config + our `swelte` key. */
export type SwelteConfig = SvelteBaseConfig & {
	swelte?: SwelteOptions
}

/** Back-compat alias: the `swelte` key payload. */
export interface SweltePrerenderOptions {
	entries?: 'static' | 'all' | 'off'
	concurrency?: number
}

export interface SwelteOfflineOptions {
	fallback?: boolean | string
}

/** Resolved config: optionals filled, nested unions widened so `Required`
 *  stays sound (TS `Required` does not distribute into nested optionals). */
export interface ResolvedSwelteOptions
	extends Omit<
		Required<SwelteOptions>,
		'prerender' | 'offline' | 'target' | 'targetOs' | 'targetArch'
	> {
	prerender: { entries: 'static' | 'all' | 'off'; concurrency: number }
	offline: { fallback: string }
	target: 'auto' | 'static' | 'node' | 'edge'
	/** Cross-build OS: `linux` | `macos` | `windows` or `''` (= host-native). */
	targetOs: 'linux' | 'macos' | 'windows' | ''
	/** Cross-build arch: `amd64` | `arm64` or `''` (= host-native). */
	targetArch: 'amd64' | 'arm64' | ''
}

/** Build the project config: `preprocess` + friends stay enumerable for the
 * svelte() vite plugin, while the `swelte` key is attached NON-enumerable.
 * That keeps it in the file for illustration and readable via `loadConfig`
 * (which re-imports the module and reads `.swelte` off the namespace), but
 * invisible to `Object.keys` — so `validateInlineOptions` in
 * vite-plugin-svelte no longer warns `invalid plugin options "swelte"` and
 * projects never strip it by hand. Deep-clone first: the same object
 * reference also feeds `svelte()`, and deleting the key there would drop it
 * for `loadConfig` too. Symbol-keyed storage would survive a spread but not
 * a fresh `import()` — non-enumerable string key does both. */
export function defineConfig(config: SwelteConfig): SvelteBaseConfig {
	const { swelte, ...rest } = config
	const out = { ...rest } as SvelteBaseConfig & { swelte?: SwelteOptions }
	if (swelte !== undefined) {
		Object.defineProperty(out, 'swelte', {
			value: swelte,
			writable: true,
			configurable: true,
			enumerable: false,
		})
	}
	return out
}

const DEFAULTS: Required<Pick<SwelteOptions, 'routesDir' | 'libDir' | 'outDir' | 'distDir'>> = {
	routesDir: 'src/routes',
	libDir: 'src/lib',
	outDir: '.swelte',
	distDir: 'dist',
}

function normalize(raw: SwelteOptions | null | undefined): ResolvedSwelteOptions {
	const r = (raw ?? {}) as SwelteOptions
	return {
		name: String(r.name ?? ''),
		routesDir: String(r.routesDir ?? DEFAULTS.routesDir),
		libDir: String(r.libDir ?? DEFAULTS.libDir),
		outDir: String(r.outDir ?? DEFAULTS.outDir),
		distDir: String(r.distDir ?? DEFAULTS.distDir),
		port: typeof r.port === 'number' && Number.isFinite(r.port) ? r.port : 8131,
		corsOrigin: String(r.corsOrigin ?? ''),
		trailingSlash:
			r.trailingSlash === 'always' || r.trailingSlash === 'never' || r.trailingSlash === 'ignore'
				? r.trailingSlash
				: 'ignore',
		base: String(r.base ?? ''),
		assets: String(r.assets ?? r.base ?? ''),
		csp: String(r.csp ?? ''),
		csrf: r.csrf === 'enforce' ? 'enforce' : 'ignore',
		methodOverride: r.methodOverride === true,
		version: String(r.version ?? ''),
		serviceWorker: normalizeServiceWorker(r.serviceWorker),
		prerender: normalizePrerender(r.prerender),
		isr: normalizeIsr(r.isr),
		target: normalizeTarget(r.target),
		targetOs: normalizeTargetOs(r.targetOs),
		targetArch: normalizeTargetArch(r.targetArch),
		offline: normalizeOffline(r.offline),
		chunking: normalizeChunking(r.chunking),
	} as ResolvedSwelteOptions
}

function normalizeChunking(raw: SwelteOptions['chunking']): 'single' | 'layout' | 'route' {
	const env = String(process.env.SWELTE_CHUNKING ?? '').trim()
	if (env === 'single' || env === 'layout' || env === 'route') return env
	if (raw === 'single' || raw === 'layout' || raw === 'route') return raw
	return 'layout'
}

function normalizePrerender(raw: SwelteOptions['prerender']): {
	entries: 'static' | 'all' | 'off'
	concurrency: number
} {
	const r = (raw ?? {}) as { entries?: unknown; concurrency?: unknown }
	const c =
		typeof r.concurrency === 'number' && Number.isFinite(r.concurrency) && r.concurrency > 0
			? Math.floor(r.concurrency)
			: 4
	return {
		entries: r.entries === 'all' ? 'all' : r.entries === 'static' ? 'static' : 'off',
		concurrency: c,
	}
}

function normalizeIsr(raw: SwelteOptions['isr']): Record<string, number> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	const out: Record<string, number> = {}
	for (const [k, v] of Object.entries(raw)) {
		if (typeof k !== 'string' || k === '') continue
		const n = typeof v === 'number' ? v : Number(v)
		if (!Number.isFinite(n) || n <= 0) continue
		out[k] = Math.floor(n)
	}
	return out
}

function normalizeTarget(raw: SwelteOptions['target']): ResolvedSwelteOptions['target'] {
	if (raw === 'static' || raw === 'node' || raw === 'edge') return raw
	return 'auto'
}

/** Lenient `swelte.targetArch` normalize: known arch (case-insensitive,
 *  `x64`/`x86_64`/`aarch64` aliases accepted) or `''` (= host-native).
 *  Never throws — CLI/env validation reports. */
function normalizeTargetArch(
	raw: SwelteOptions['targetArch']
): ResolvedSwelteOptions['targetArch'] {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (v === 'amd64' || v === 'x64' || v === 'x86_64' || v === 'x86-64') return 'amd64'
	if (v === 'arm64' || v === 'aarch64') return 'arm64'
	return ''
}

/** Lenient `swelte.targetOs` normalize: known OS (case-insensitive) or
 * `''` (= host-native). Never throws — CLI/env validation reports. */
function normalizeTargetOs(raw: SwelteOptions['targetOs']): ResolvedSwelteOptions['targetOs'] {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (v === 'linux' || v === 'macos' || v === 'windows') return v
	return ''
}

function normalizeOffline(raw: SwelteOptions['offline']): { fallback: string } {
	const r = (raw ?? {}) as { fallback?: unknown }
	// Disabled unless explicitly configured: `true` = default `offline.html`,
	// string = custom precache path. `false`/missing/anything else = off.
	if (r.fallback === true) return { fallback: 'offline.html' }
	if (typeof r.fallback === 'string' && r.fallback !== '') return { fallback: r.fallback }
	return { fallback: 'off' }
}

function normalizeServiceWorker(
	raw: SwelteOptions['serviceWorker']
): Required<Required<SwelteOptions>['serviceWorker']> {
	const r = (raw ?? {}) as { enabled?: unknown; register?: unknown }
	return {
		enabled: r.enabled === true,
		register: r.register === 'manual' ? 'manual' : 'auto',
	}
}

/** Load `<root>/svelte.config.js` (default export), reading the `swelte` key;
 *  missing file/key falls back to `<root>/package.json`'s `swelte` key
 *  (deploy-target declaration lives with the package, e.g. docs-site's
 *  targetOs/targetArch that `npm i` uses to prep zig), then to defaults.
 *  Also honors a legacy `<root>/swelte.config.ts` default export. */
export async function loadConfig(root: string): Promise<ResolvedSwelteOptions> {
	const dir = resolve(root)
	const files = [
		join(dir, 'svelte.config.js'),
		join(dir, 'svelte.config.ts'),
		join(dir, 'swelte.config.ts'),
	]
	for (const file of files) {
		if (!existsSync(file)) continue
		try {
			const mod = (await import(pathToFileURL(file).href + `?t=${Date.now()}`)) as {
				default?: SwelteConfig | SwelteOptions
			}
			const d = mod.default as SwelteConfig | SwelteOptions | undefined
			if (!d) return normalize(readPackageSwelte(dir))
			// svelte.config.* carries our fields under the `swelte` key
			// (non-enumerable since defineConfig hides it from the svelte()
			// plugin — direct access still reads it); legacy swelte.config.ts
			// held them at the top level.
			const maybeSwelte = (d as SwelteConfig).swelte as SwelteOptions | undefined
			const opts = maybeSwelte ?? (d as SwelteOptions)
			return normalize(mergePackageSwelte(dir, opts))
		} catch (e) {
			// Never silent: a syntax error in svelte.config.js previously
			// fell back to defaults (wrong dirs, confusing codegen).
			console.warn(`[swelte] ${file} failed to load, using defaults: ${(e as Error).message}`)
			return normalize(readPackageSwelte(dir))
		}
	}
	return normalize(readPackageSwelte(dir))
}

/** Read `<dir>/package.json`'s `swelte` key (deploy-target declaration).
 *  Never throws — missing/malformed = {}. */
function readPackageSwelte(dir: string): SwelteOptions {
	try {
		const pkg = join(dir, 'package.json')
		if (!existsSync(pkg)) return {}
		const sw = (JSON.parse(readFileSync(pkg, 'utf8')) as { swelte?: unknown }).swelte
		if (!sw || typeof sw !== 'object' || Array.isArray(sw)) return {}
		return sw as SwelteOptions
	} catch {
		return {}
	}
}

/** svelte.config wins field-by-field; package.json fills the gaps the
 *  config file leaves unset (so `swelte.targetOs` in package.json is a
 *  real fallback, not dead config). Explicit `''`/undefined in the file
 *  still count as unset — normalize() treats them as host-native anyway. */
function mergePackageSwelte(dir: string, fileOpts: SwelteOptions): SwelteOptions {
	const pkg = readPackageSwelte(dir)
	if (Object.keys(pkg).length === 0) return fileOpts
	const out = { ...pkg, ...fileOpts }
	// svelte.config `targetOs: ''` must not clobber package.json's value:
	// re-apply package fields the file left empty/undefined.
	for (const k of ['targetOs', 'targetArch'] as const) {
		const fv = (fileOpts as Record<string, unknown>)[k]
		const pv = (pkg as Record<string, unknown>)[k]
		if ((fv === '' || fv === undefined) && pv !== undefined && pv !== '') {
			;(out as Record<string, unknown>)[k] = pv
		}
	}
	return out
}

/** Resolve the on-disk templates dir (works from src/ and dist/). */
export function templatesDir(fromUrl: string): string {
	const here = dirname(fileURLToPath(fromUrl))
	const candidates = [
		join(here, '..', '..', 'templates'), // dist/gen/*.js -> dist/../templates
		join(here, '..', 'templates'), // dist/*.js -> dist/../templates
		join(here, 'templates'), // src/gen/*.ts edge
		join(here, '..', '..', 'src', '..', 'templates'),
	]
	for (const c of candidates) {
		if (existsSync(join(c, 'harness', 'server.v'))) return c
	}
	// Fallback: source tree relative to this file (dev via tsx/vite).
	return join(here, '..', '..', 'templates')
}

/** Render the server harness: skeleton from templates/ + user hooks from
 *  `src/app.v` (`@[startup]` runs once in main, `@[reroute]` rewrites
 *  host/path in before_request, `@[error]` sanitizes error messages,
 *  `@[cron]` spawn loops in main).
 *  Absent hooks → byte-identical skeleton. */
export function renderHarness(
	_config: Required<SwelteOptions>,
	fromUrl: string,
	hooks?: {
		startupBody?: string
		rerouteBody?: string
		errorBody?: string
		crons?: { seconds: number; body: string; fallible: boolean }[]
	}
): string {
	const file = join(templatesDir(fromUrl), 'harness', 'server.v')
	let src = readFileSync(file, 'utf8')
	const indent = (body: string): string =>
		body
			.split('\n')
			.map((l) => (l.trim() === '' ? '' : '\t' + l))
			.join('\n')
	if (hooks?.crons?.length) {
		const anchor = 'fn main() {'
		let defs = ''
		let spawns = ''
		let n = 0
		for (const c of hooks.crons) {
			n++
			const sig = c.fallible ? `fn swelte_cron_${n}() !void {` : `fn swelte_cron_${n}() {`
			const call = c.fallible
				? `swelte_cron_${n}() or { eprintln('[swelte:cron] ' + err.msg()) }`
				: `swelte_cron_${n}()`
			defs +=
				`// @[cron] tick ${n} (src/app.v) — user body, top-level so fallible fns compile.\n` +
				`${sig}\n` +
				indent(c.body) +
				'\n}\n' +
				`fn swelte_cron_loop_${n}() {\n\tfor {\n\t\ttime.sleep(${c.seconds} * time.second)\n` +
				indent(call) +
				'\n\t}\n}\n'
			spawns += `\tspawn swelte_cron_loop_${n}()\n`
		}
		const cronBlock =
			'// @[cron] (src/app.v) — spawn + time.sleep loops, single-instance best-effort.\n' +
			'// No watchdog: long-lived by design. Bodies must be idempotent.\n' +
			spawns
		if (src.includes(anchor)) src = src.replace(anchor, defs + anchor)
		else src += '\n// @[cron] anchor missing — harness template changed.\n'
		const mainAnchor = '\tmut app := &App{}'
		if (src.includes(mainAnchor)) src = src.replace(mainAnchor, cronBlock + mainAnchor)
		else src += '\n// @[cron] spawn anchor missing — harness template changed.\n'
	}
	if (hooks?.startupBody !== undefined) {
		const anchor = '\tmut app := &App{}'
		const inject =
			'\tmut app := &App{}\n' +
			'\t// @[startup] (src/app.v) — once, before veb.run. Throw aborts boot.\n' +
			'\t{\n' +
			indent(hooks.startupBody) +
			'\n\t}'
		if (src.includes(anchor)) src = src.replace(anchor, inject)
		else src += '\n// @[startup] anchor missing — harness template changed.\n'
	}
	if (hooks?.rerouteBody !== undefined) {
		const anchor = 'path := if ctx.req.url.contains'
		const idx = src.indexOf(anchor)
		if (idx >= 0) {
			const lineEnd = src.indexOf('\n', idx)
			const inject =
				src.slice(0, lineEnd + 1) +
				'\t// @[reroute] (src/app.v) — host/path rewrite before dispatch.\n' +
				"\t// Returns rewritten path or '' for no-op. Must be pure + fast.\n" +
				'\t{\n' +
				"\t\thost_reroute := ctx.req.header.get_custom('Host') or { ctx.req.header.get(.host) or { '' } }\n" +
				'\t\trerouted := (fn (host string, path string) string {\n' +
				indent(indent(hooks.rerouteBody)) +
				'\n\t\t})(host_reroute, path)\n' +
				"\t\tif rerouted != '' { path = rerouted }\n" +
				'\t}'
			src = inject + src.slice(lineEnd + 1)
		} else {
			src += '\n// @[reroute] anchor missing — harness template changed.\n'
		}
	}
	if (hooks?.errorBody !== undefined) {
		const anchor = 'fn swelte_sanitize_error(message string, status int) string {'
		const inject =
			'// @[error] (src/app.v) — SvelteKit handleError lite: sanitize the\n' +
			'// throw message before it reaches the client (+error props / JSON).\n' +
			"// Return '' to keep the message, or a sanitized replacement.\n" +
			'fn swelte_sanitize_error(message string, status int) string {\n' +
			'\tsanitized := (fn (message string, status int) string {\n' +
			indent(indent(hooks.errorBody)) +
			'\n\t})(message, status)\n' +
			"\tif sanitized != '' { return sanitized }\n" +
			'\treturn message\n' +
			'}\n'
		const idx = src.indexOf(anchor)
		if (idx >= 0) {
			// Consume the template default body (through its closing brace):
			// the old code replaced only the anchor line and left
			// `\t_ = status\n\treturn message\n}` behind — invalid V.
			const bodyStart = idx + anchor.length
			let depth = 1
			let i = bodyStart
			for (; i < src.length && depth > 0; i++) {
				if (src[i] === '{') depth++
				else if (src[i] === '}') depth--
			}
			src = src.slice(0, idx) + inject + src.slice(i)
		} else src += `\n${inject}`
	}
	return src
}

/** Render the client entry: `templates/client/main.ts` verbatim (its
 *  `./routes.js` import already targets the `.swelte/` sibling) plus
 *  user-owned setup pulled in by the generated entry (inverted wiring):
 *  when `<root>/src/app.ts` exists it is imported for side effects
 *  (as `../src/app.js` — `.js` specifier so `tsc` stays clean without
 *  `allowImportingTsExtensions`); legacy `<root>/src/client.ts` is
 *  honored the same way when `app.ts` is absent. When
 *  `<root>/src/app.css` exists it is imported too. Missing files emit
 *  a comment line instead, so the entry never throws when the hooks
 *  are absent. Legacy `src/main.ts` shims are NOT auto-imported: they
 *  contain `import '../.swelte/entry-main.ts'` (reimporting the entry
 *  would cycle) — move custom setup to `src/app.ts` and delete them. */
export function renderClientEntry(root: string, fromUrl: string): string {
	const file = join(templatesDir(fromUrl), 'client', 'main.ts')
	const src = readFileSync(file, 'utf8')
	const lines: string[] = []
	if (existsSync(join(resolve(root), 'src', 'app.ts'))) lines.push(`import '../src/app.js'`)
	else if (existsSync(join(resolve(root), 'src', 'client.ts')))
		lines.push(`import '../src/client.js'`)
	else lines.push(`// Optional user hook: create src/app.ts for app-level setup.`)
	if (existsSync(join(resolve(root), 'src', 'app.css'))) lines.push(`import '../src/app.css'`)
	return lines.join('\n') + '\n' + src
}

/** Declaration bundle for the `$app/*` compat stubs (single source of
 * truth — `generate()` writes it to every `.swelte/app/*.d.ts`). */
export function renderAppDts(): string {
	return `// Auto-generated by swelte. Do not edit.
import type { SwelteStore, SweltePageState, SwelteNavigatingState } from '@swelte/core'
export declare const page: SwelteStore<SweltePageState>
export declare const navigating: SwelteStore<SwelteNavigatingState | null>
export declare const updated: SwelteStore<boolean>
export declare function goto(url: string, opts?: unknown): Promise<void>
export declare function preloadData(url: string): Promise<unknown>
export declare function preloadCode(url: string): Promise<unknown>
export declare function pushState(url: string, state?: unknown): Promise<void>
export declare function replaceState(url: string, state?: unknown): Promise<void>
export declare function captureSnapshot(fn: unknown): () => void
export declare function restoreSnapshot(fn: unknown): () => void
export declare function beforeNavigate(fn: unknown): () => void
export declare function afterNavigate(fn: unknown): () => void
export declare function onNavigate(fn: unknown): () => void
export declare function checkUpdated(): Promise<boolean>
export declare function handleFetch(fn: unknown): () => void
export declare function swelteError(status: number, message: string): unknown
export declare function isRedirect(e: unknown): boolean
`
}
