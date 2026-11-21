import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from '@swelte/core/config'

/** @type {import('@swelte/core/config').SwelteConfig} */
export default defineConfig({
	preprocess: vitePreprocess(),
	compilerOptions: { experimental: { async: true } },
})
