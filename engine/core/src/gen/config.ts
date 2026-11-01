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

/** Render the server harness: verbatim skeleton from templates/ (no injection —
 *  all knobs are env-driven at runtime: PORT, SWELTE_DIST, SWELTE_CORS_ORIGIN).
 *  Kept as a function so later config values can be templated in one place. */
export function renderHarness(_config: Required<SwelteOptions>, fromUrl: string): string {
	const file = join(templatesDir(fromUrl), 'harness', 'server.v')
	return readFileSync(file, 'utf8')
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
