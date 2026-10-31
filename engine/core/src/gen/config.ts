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

export function defineConfig(config: SwelteConfig): SwelteConfig {
	return config
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
	const files = [join(dir, 'svelte.config.js'), join(dir, 'svelte.config.ts'), join(dir, 'swelte.config.ts')]
	for (const file of files) {
		if (!existsSync(file)) continue
		try {
			const mod = (await import(pathToFileURL(file).href + `?t=${Date.now()}`)) as {
				default?: SwelteConfig | SwelteOptions
			}
			const d = mod.default as SwelteConfig | SwelteOptions | undefined
			if (!d) return normalize({})
			// svelte.config.* carries our fields under the `swelte` key;
			// legacy swelte.config.ts held them at the top level.
			const opts = (d as SwelteConfig).swelte ?? (d as SwelteOptions)
			return normalize(opts)
		} catch {
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
