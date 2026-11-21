import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { swelte } from '@swelte/core/vite'
import svelteConfig from './svelte.config.js'

// Client <await> needs Svelte experimental.async. The flag lives in
// svelte.config.js (the language server reads that file directly);
// vite.config.ts spreads it through for the Vite build.
const svelteOptions = {
	...svelteConfig,
	compilerOptions: {
		...((svelteConfig as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {}),
		experimental: {
			...((((svelteConfig as { compilerOptions?: { experimental?: Record<string, unknown> } })
				.compilerOptions ?? {}).experimental ?? {}) as Record<string, unknown>),
			async: true,
		},
	},
}

const vBackendUrl =
	process.env.SWELTE_V_BACKEND_URL ?? process.env.VITE_SWELTE_V_BACKEND_URL ?? 'http://localhost:8131'

export default defineConfig({
	plugins: [
		svelte(svelteOptions as Parameters<typeof svelte>[0]),
		swelte({
			vBackendUrl,
		}),
	],
})
