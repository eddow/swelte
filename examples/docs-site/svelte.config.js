import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from '@swelte/core/config';

/** @type {import('@swelte/core/config').SwelteConfig} */
export default defineConfig({
	preprocess: vitePreprocess(),
	// Client <await> (Svelte 5 experimental.async) lives here — NOT only in
	// vite.config.ts (language server reads this file directly, never vite's).
	compilerOptions: { experimental: { async: true } },
	swelte: {
		name: 'docs-site',
		routesDir: 'src/routes',
		libDir: 'src/lib',
		outDir: '.swelte'
	}
});
