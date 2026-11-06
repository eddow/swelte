import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { runInit } from './init.js'

function ctxFor(dir: string, opts: Record<string, unknown>, rest: string[] = []) {
	const logs: string[] = []
	return {
		ctx: {
			argv: [],
			opts: opts as never,
			rest,
			log: (m: string) => logs.push(m),
			error: (m: string) => logs.push(m),
		},
		logs,
		parent: dir,
	}
}

describe('swelte init scaffolds (no prompt in tests)', () => {
	it('empty scaffold: no api routes dir', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { empty: true, root: parent }, ['empty-app'])
		await runInit(ctx as never)
		assert.ok(existsSync(join(parent, 'empty-app', 'package.json')))
		assert.ok(existsSync(join(parent, 'empty-app', 'src', 'routes', '+page.v')))
		assert.ok(!existsSync(join(parent, 'empty-app', 'src', 'routes', 'api')))
	})

	it('sample scaffold: greet route present + __NAME__ replaced', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { sample: true, root: parent }, ['sample-app'])
		await runInit(ctx as never)
		assert.ok(existsSync(join(parent, 'sample-app', 'src', 'routes', 'api', 'greet.v')))
		const pkg = readFileSync(join(parent, 'sample-app', 'package.json'), 'utf8')
		assert.ok(pkg.includes('sample-app'))
		assert.ok(!pkg.includes('__NAME__'))
	})

	it('non-empty target throws', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		mkdirSync(join(parent, 'taken'), { recursive: true })
		writeFileSync(join(parent, 'taken', 'x.txt'), 'hi')
		const { ctx } = ctxFor(parent, { empty: true, root: parent }, ['taken'])
		await assert.rejects(() => runInit(ctx as never), /not empty/)
	})

	it('template: empty alias bypasses prompt', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { template: 'empty', root: parent }, ['alias-app'])
		await runInit(ctx as never)
		assert.ok(existsSync(join(parent, 'alias-app', 'package.json')))
	})

	it('--ssr adds @swelte/ssr-qjs dep + adapter import', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { empty: true, ssr: true, root: parent }, ['ssr-app'])
		await runInit(ctx as never)
		const pkg = JSON.parse(readFileSync(join(parent, 'ssr-app', 'package.json'), 'utf8'))
		assert.ok(pkg.dependencies['@swelte/ssr-qjs'], 'ssr dep present')
		assert.ok(!String(pkg.dependencies['@swelte/ssr-qjs']).includes('__SWELTE_VERSION__'))
		const vite = readFileSync(join(parent, 'ssr-app', 'vite.config.ts'), 'utf8')
		assert.ok(vite.includes(`from '@swelte/ssr-qjs'`), 'adapter import swapped')
		assert.ok(!vite.includes('@swelte/core/vite'))
	})

	it('default stays SPA-only (core import, no ssr dep)', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { empty: true, root: parent }, ['spa-app'])
		await runInit(ctx as never)
		const pkg = JSON.parse(readFileSync(join(parent, 'spa-app', 'package.json'), 'utf8'))
		assert.equal(pkg.dependencies['@swelte/ssr-qjs'], undefined)
		const vite = readFileSync(join(parent, 'spa-app', 'vite.config.ts'), 'utf8')
		assert.ok(vite.includes(`from '@swelte/core/vite'`))
	})

	it('scaffold scopes npm-skills to @swelte/* (import-only deps crash extract)', async () => {
		// @sveltejs/vite-plugin-svelte@5 ships import-only `exports` (no
		// require main, no ./package.json subpath). npm-skills@0.5.1 resolves
		// every scanned dep via require.resolve, which throws
		// ERR_PACKAGE_PATH_NOT_EXPORTED ("No exports main defined") on such
		// packages under Node 24 and fails `npm install`. The template must
		// scope extraction so unrelated packages are never resolved.
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { empty: true, root: parent }, ['scoped-app'])
		await runInit(ctx as never)
		const pkg = JSON.parse(readFileSync(join(parent, 'scoped-app', 'package.json'), 'utf8'))
		assert.deepEqual(pkg.npmSkills?.consume?.only, ['@swelte/*'])
	})
})
