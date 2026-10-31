// `swelte()` adapter wrapper: re-exports core's plugin, adds SSR build.
// Extends `@swelte/core/vite`: same options pass through
// (`vBackendUrl, routesDir, libDir`), engine behavior augments via
// `generateBundle` (emit `dist/ssr/render.js`).
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
}

export function swelte(options: SsrQjsOptions = {}): Plugin[] {
	const core = coreSwelte({
		vBackendUrl: options.vBackendUrl,
		routesDir: options.routesDir,
		libDir: options.libDir,
		outDir: options.outDir,
	})

	const adapter: Plugin = {
		name: 'swelte:ssr-qjs',
		enforce: 'post',
		async generateBundle() {
			// Compose dist/ssr/render.js from .swelte/ssr-manifest.json.
			const { readFileSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs')
			const { join } = await import('node:path')
			const root: string =
				(this as unknown as { environment?: { config?: { root?: string } } }).environment?.config
					?.root ?? process.cwd()
			const outDir = String(options.outDir ?? '.swelte')
			const manifestFile = join(root, outDir, 'ssr-manifest.json')
			if (!existsSync(manifestFile)) return
			const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
			const renderJs = composeRenderJs(manifest, { root })
			mkdirSync(join(root, 'dist', 'ssr'), { recursive: true })
			writeFileSync(join(root, 'dist', 'ssr', 'render.js'), renderJs)
		},
	}

	return [core, adapter]
}
