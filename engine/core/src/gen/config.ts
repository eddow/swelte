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
}

/** Project config: standard Svelte config + our `swelte` key. */
export type SwelteConfig = SvelteBaseConfig & {
	swelte?: SwelteOptions
}

/** Back-compat alias: the `swelte` key payload. */
export type { SwelteOptions as SwelteConfigOptions }

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

function normalize(raw: SwelteOptions | null | undefined): Required<SwelteOptions> {
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
		assets: String(r.assets ?? (r.base ?? '')),
		csp: String(r.csp ?? ''),
		csrf: r.csrf === 'enforce' ? 'enforce' : 'ignore',
		methodOverride: r.methodOverride === true,
		version: String(r.version ?? ''),
		serviceWorker: normalizeServiceWorker(r.serviceWorker),
	}
}

function normalizeServiceWorker(
	raw: SwelteOptions['serviceWorker'],
): Required<Required<SwelteOptions>['serviceWorker']> {
	const r = (raw ?? {}) as { enabled?: unknown; register?: unknown }
	return {
		enabled: r.enabled === true,
		register: r.register === 'manual' ? 'manual' : 'auto',
	}
}

/** Load `<root>/svelte.config.js` (default export), reading the `swelte` key;
 *  missing file/key falls back to defaults. Also honors a legacy
 *  `<root>/swelte.config.ts` default export during migration. */
export async function loadConfig(root: string): Promise<Required<SwelteOptions>> {
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
			if (!d) return normalize({})
			// svelte.config.* carries our fields under the `swelte` key
			// (non-enumerable since defineConfig hides it from the svelte()
			// plugin — direct access still reads it); legacy swelte.config.ts
			// held them at the top level.
			const maybeSwelte = (d as SwelteConfig).swelte as SwelteOptions | undefined
			const opts = maybeSwelte ?? (d as SwelteOptions)
			return normalize(opts)
		} catch (e) {
			// Never silent: a syntax error in svelte.config.js previously
			// fell back to defaults (wrong dirs, confusing codegen).
			console.warn(`[swelte] ${file} failed to load, using defaults: ${(e as Error).message}`)
			return normalize({})
		}
	}
	return normalize({})
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
 *  `src/server.v` (`@[startup]` runs once in main, `@[reroute]` rewrites
 *  host/path in before_request). Absent hooks → byte-identical skeleton. */
export function renderHarness(
	_config: Required<SwelteOptions>,
	fromUrl: string,
	hooks?: { startupBody?: string; rerouteBody?: string }
): string {
	const file = join(templatesDir(fromUrl), 'harness', 'server.v')
	let src = readFileSync(file, 'utf8')
	const indent = (body: string): string =>
		body
			.split('\n')
			.map((l) => (l.trim() === '' ? '' : '\t' + l))
			.join('\n')
	if (hooks?.startupBody !== undefined) {
		const anchor = '\tmut app := &App{}'
		const inject =
			'\tmut app := &App{}\n' +
			'\t// @[startup] (src/server.v) — once, before veb.run. Throw aborts boot.\n' +
			'\t{\n' +
			indent(hooks.startupBody) +
			'\n\t}'
		if (src.includes(anchor)) src = src.replace(anchor, inject)
		else src += '\n// @[startup] anchor missing — harness template changed.\n'
	}
	if (hooks?.rerouteBody !== undefined) {
		const anchor = '\tpath := if ctx.req.url.contains'
		const idx = src.indexOf(anchor)
		if (idx >= 0) {
			const lineEnd = src.indexOf('\n', idx)
			const inject =
				src.slice(0, lineEnd + 1) +
				'\t// @[reroute] (src/server.v) — host/path rewrite before dispatch.\n' +
				'\t// Returns rewritten path or \'\' for no-op. Must be pure + fast.\n' +
				'\t{\n' +
				'\t\thost_reroute := ctx.req.header.get_custom(\'Host\') or { ctx.req.header.get(.host) or { \'\' } }\n' +
				'\t\trerouted := (fn (host string, path string) string {\n' +
				indent(indent(hooks.rerouteBody)) +
				'\n\t\t})(host_reroute, path)\n' +
				'\t\tif rerouted != \'\' { path = rerouted }\n' +
				'\t}'
			src = inject + src.slice(lineEnd + 1)
		} else {
			src += '\n// @[reroute] anchor missing — harness template changed.\n'
		}
	}
	return src
}

/** Render the client entry: verbatim `templates/client/main.ts` (its
 *  `./routes.js` import already targets the `.swelte/` sibling).
 *  User hook: when `<root>/src/client.ts` exists it is imported for
 *  side effects (app setup) before the router mounts — engine composes,
 *  user fills. Never throws when the hook is absent. */
export function renderClientEntry(root: string, fromUrl: string): string {
	const file = join(templatesDir(fromUrl), 'client', 'main.ts')
	const src = readFileSync(file, 'utf8')
	const hook = existsSync(join(resolve(root), 'src', 'client.ts'))
		? `import '../src/client.js'\n`
		: `// Optional user hook: create src/client.ts for app-level setup.\n`
	return hook + src
}

/** Declaration bundle for the `$app/*` compat stubs (single source of
 * truth — `generate()` writes it to every `.swelte/app/*.d.ts`). */
export function renderAppDts(): string {
	return `// Auto-generated by swelte. Do not edit.
import type { SwelteStore, SweltePageState, SwelteNavigatingState } from '@swelte/core';
export declare const page: SwelteStore<SweltePageState>;
export declare const navigating: SwelteStore<SwelteNavigatingState | null>;
export declare const updated: SwelteStore<boolean>;
export declare function goto(url: string, opts?: unknown): Promise<void>;
export declare function preloadData(url: string): Promise<unknown>;
export declare function pushState(url: string, state?: unknown): Promise<void>;
export declare function beforeNavigate(fn: unknown): () => void;
export declare function afterNavigate(fn: unknown): () => void;
export declare function onNavigate(fn: unknown): () => void;
`
}
