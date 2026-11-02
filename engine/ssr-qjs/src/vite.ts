// `swelte()` adapter wrapper: re-exports core's plugin, adds SSR build.
// Extends `@swelte/core/vite`: same options pass through
// (`vBackendUrl, routesDir, libDir, outDir`), engine behavior augments via
// `generateBundle` (emit `dist/ssr/render.js` + QJS link).
//
// Core remains completely clean — this module owns the dynamic imports
// and build augmentation.
import type { Plugin } from 'vite'
import { swelte as coreSwelte } from '@swelte/core/vite'
import { composeRenderJs } from './ssr.js'

export interface SsrQjsOptions {
	vBackendUrl?: string
	routesDir?: string
	libDir?: string
	outDir?: string
	/** QJS render budget in ms before SPA fallback (default 50). */
	renderTimeoutMs?: number
	/** QJS memory cap in MB (default 16). */
	renderMemoryMB?: number
	/** Opt-in service worker (core-owned, additive dist/sw.js). Same shape as core. */
	serviceWorker?: { enabled?: boolean; register?: 'auto' | 'manual' }
	trailingSlash?: 'always' | 'never' | 'ignore'
	base?: string
	assets?: string
	csp?: string
	csrf?: 'ignore' | 'enforce'
	methodOverride?: boolean
	version?: string
}

export function swelte(options: SsrQjsOptions = {}): Plugin[] {
	// Adapter-owned keys stay here (QJS link budget, consumed below by
	// buildQjsProd); everything else passes through to core. Rest-spread
	// keeps explicit `undefined`s, which core treats as unset — same as
	// the pre-experiment HEAD. Plain Object.assign({}, options) would
	// leak renderTimeoutMs/renderMemoryMB into core's options.
	const { renderTimeoutMs, renderMemoryMB, ...coreOpts } = options
	// Env wins for the SW gate even when the adapter wraps core statically:
	// forward the live env read so SWELTE_SW=1 emits without touching config.
	if (process.env.SWELTE_SW === '1' && coreOpts.serviceWorker?.enabled === undefined) {
		coreOpts.serviceWorker = { ...(coreOpts.serviceWorker ?? {}), enabled: true }
	}
	const core = coreSwelte(coreOpts)

	const adapter: Plugin = {
		name: 'swelte:ssr-qjs',
		enforce: 'post',
		async generateBundle() {
			// Real SSR compile: manifest → per-route generate:'server' →
			// Rollup IIFE → dist/ssr/render.js (+ .swelte/dev/render.js).
			const { readFileSync, existsSync } = await import('node:fs')
			const { join } = await import('node:path')
			const root: string =
				(this as unknown as { environment?: { config?: { root?: string } } }).environment?.config
					?.root ?? process.cwd()
			const outDir = String(options.outDir ?? '.swelte')
			const manifestFile = join(root, outDir, 'ssr-manifest.json')
			if (!existsSync(manifestFile)) return
			const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
			const { emitRenderJs } = await import('./ssr.js')
			const outFile = await emitRenderJs(manifest, {
				root,
				routesDir: String(options.routesDir ?? 'src/routes'),
				prod: true,
			})
			// QJS prod link (adapter-owned): vendored QuickJS → libqjs.a +
			// routes/swelte_qjs_bridge.v (generate() picks it up next run;
			// `swelte build` runs generate→vite→v-o, so the bridge compiles
			// into the binary on the following build — see buildQjsProd).
			try {
				const { buildQjsProd } = await import('./qjs.js')
				const prod = buildQjsProd({
					root,
					renderJs: outFile,
					outDir,
					timeoutMs: renderTimeoutMs,
					memoryMB: renderMemoryMB,
				})
				console.log(`[swelte:ssr-qjs] QJS bridge: ${prod.bridge}`)
				if (prod.qjscNote) console.log(`[swelte:ssr-qjs] ${prod.qjscNote}`)
			} catch (e) {
				console.warn(`[swelte:ssr-qjs] QJS link skipped: ${(e as Error).message}`)
			}
		},
	}

	return [core, adapter]
}
