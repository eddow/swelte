import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { runCreate } from './scaffold.js'

function run(_dir: string, opts: Record<string, unknown>, rest: string[] = []) {
	const logs: string[] = []
	return runCreate(opts as never, rest, (m: string) => logs.push(m)).then(() => ({ logs }))
}

describe('create-@swelte scaffolds (no prompt in tests)', () => {
	it('empty scaffold: no api routes dir', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { empty: true, root: parent }, ['empty-app'])
		assert.ok(existsSync(join(parent, 'empty-app', 'package.json')))
		assert.ok(existsSync(join(parent, 'empty-app', 'src', 'routes', '+page.v')))
		assert.ok(!existsSync(join(parent, 'empty-app', 'src', 'routes', 'api')))
	})

	it('scaffold ships README + build:local script', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { empty: true, root: parent }, ['readme-app'])
		const readme = readFileSync(join(parent, 'readme-app', 'README.md'), 'utf8')
		assert.ok(readme.includes('<!-- swelte:deploy -->'))
		assert.ok(readme.includes('<!-- /swelte:deploy -->'))
		assert.ok(readme.includes('`dist/server`'))
		const pkg = JSON.parse(readFileSync(join(parent, 'readme-app', 'package.json'), 'utf8'))
		assert.equal(pkg.scripts.build, 'swelte build')
		assert.equal(pkg.scripts['build:local'], 'swelte build --local')
		assert.ok(!('build:deploy' in pkg.scripts) && !('preview:deploy' in pkg.scripts))
		assert.ok(readme.includes('readme-app'))
	})

	it('scaffolded project holds exactly one ignore file (.gitignore, no stray gitignore)', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { empty: true, root: parent }, ['gi-app'])
		const gi = readFileSync(join(parent, 'gi-app', '.gitignore'), 'utf8')
		assert.ok(gi.includes('.svelte/'))
		assert.ok(gi.includes('node_modules/'))
		assert.ok(!existsSync(join(parent, 'gi-app', 'gitignore')))
	})

	it('empty scaffold ships conventional dirs (src/lib, assets) with explainer READMEs', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { empty: true, root: parent }, ['dirs-app'])
		assert.ok(existsSync(join(parent, 'dirs-app', 'src', 'lib', 'README.md')))
		assert.ok(existsSync(join(parent, 'dirs-app', 'assets', 'README.md')))
	})

	it('sample scaffold: greet route present + __NAME__ replaced', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { sample: true, root: parent }, ['sample-app'])
		assert.ok(existsSync(join(parent, 'sample-app', 'src', 'routes', 'api', 'greet.v')))
		const pkg = readFileSync(join(parent, 'sample-app', 'package.json'), 'utf8')
		assert.ok(pkg.includes('sample-app'))
		assert.ok(!pkg.includes('__NAME__'))
	})

	it('non-empty target throws', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		mkdirSync(join(parent, 'taken'), { recursive: true })
		writeFileSync(join(parent, 'taken', 'x.txt'), 'hi')
		await assert.rejects(() => run(parent, { empty: true, root: parent }, ['taken']), /not empty/)
	})

	it('template: empty alias bypasses prompt', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { template: 'empty', root: parent }, ['alias-app'])
		assert.ok(existsSync(join(parent, 'alias-app', 'package.json')))
	})

	it('--lib scaffolds src/lib hello.v + src/routes dogfood (no sample, lib package.json)', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { lib: true, root: parent }, ['my-lib'])
		assert.ok(existsSync(join(parent, 'my-lib', 'src', 'lib', 'hello', 'api.v')))
		assert.ok(existsSync(join(parent, 'my-lib', 'src', 'routes', '+page.v')))
		assert.ok(!existsSync(join(parent, 'my-lib', 'src', 'routes', 'api')))
		const pkg = JSON.parse(readFileSync(join(parent, 'my-lib', 'package.json'), 'utf8'))
		assert.equal(pkg.private, undefined)
		assert.deepEqual(pkg.files, ['dist', 'src/lib/**/*.v'])
		assert.ok(pkg.scripts['build:lib'].includes('swelte package'))
		assert.ok(pkg.scripts['build:lib'].includes('swelte check --lib'))
		assert.ok(pkg.scripts.build === 'swelte build')
		assert.ok(
			!(
				'devDependencies' in pkg &&
				(pkg.devDependencies as Record<string, string>)['@sveltejs/package']
			),
			'packager is core-owned, not a scaffold dep'
		)
		assert.ok(pkg.swelte.v.exports['./hello.v'])
		assert.equal(pkg.swelte.v.exports['./hello.v'].source, './src/lib/hello')
		assert.equal(pkg.swelte.v.exports['./hello.v'].entry, './src/lib/hello/api.v')
	})

	it('--kind lib equals --lib (explicit kind, no prompt)', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { kind: 'lib', root: parent }, ['kind-lib'])
		assert.ok(existsSync(join(parent, 'kind-lib', 'src', 'lib', 'hello', 'api.v')))
	})

	it('--template lib scaffolds a library', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { template: 'lib', root: parent }, ['tpl-lib'])
		assert.ok(existsSync(join(parent, 'tpl-lib', 'src', 'lib', 'hello', 'api.v')))
	})

	it('--ssr adds @swelte/ssr-qjs dep + adapter import', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { empty: true, ssr: true, root: parent }, ['ssr-app'])
		const pkg = JSON.parse(readFileSync(join(parent, 'ssr-app', 'package.json'), 'utf8'))
		assert.ok(pkg.dependencies['@swelte/ssr-qjs'], 'ssr dep present')
		assert.ok(!String(pkg.dependencies['@swelte/ssr-qjs']).includes('__SWELTE_VERSION'))
		assert.ok(!String(pkg.dependencies['@swelte/core']).includes('__SWELTE_VERSION'))
		assert.ok(!String(pkg.devDependencies['@swelte/vvm']).includes('__SWELTE_VERSION'))
		// Scaffold floors stay on the reviewed line: an independent create
		// patch must never generate a minimum from a line that was never cut.
		const { TEMPLATE_DEPS, TEMPLATE_LINE } = await import('./scaffold.js')
		for (const [dep, v] of Object.entries(TEMPLATE_DEPS)) {
			assert.ok(
				String(v).startsWith(`${TEMPLATE_LINE}.`),
				`${dep}@${v} not on template line ${TEMPLATE_LINE}`
			)
		}
		assert.ok(String(pkg.dependencies['@swelte/core']).startsWith(`^${TEMPLATE_LINE}.`))
		assert.ok(String(pkg.dependencies['@swelte/ssr-qjs']).startsWith(`^${TEMPLATE_LINE}.`))
		assert.ok(String(pkg.devDependencies['@swelte/vvm']).startsWith(`^${TEMPLATE_LINE}.`))
		const vite = readFileSync(join(parent, 'ssr-app', 'vite.config.ts'), 'utf8')
		assert.ok(vite.includes(`from '@swelte/ssr-qjs'`), 'adapter import swapped')
		assert.ok(!vite.includes('@swelte/core/vite'))
	})

	it('default stays SPA-only (core import, no ssr dep)', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { empty: true, root: parent }, ['spa-app'])
		const pkg = JSON.parse(readFileSync(join(parent, 'spa-app', 'package.json'), 'utf8'))
		assert.equal(pkg.dependencies['@swelte/ssr-qjs'], undefined)
		const vite = readFileSync(join(parent, 'spa-app', 'vite.config.ts'), 'utf8')
		assert.ok(vite.includes(`from '@swelte/core/vite'`))
	})

	it('scaffold scopes npm-skills to @swelte/* (import-only deps crash extract)', async () => {
		// @sveltejs/vite-plugin-svelte@5 ships import-only `exports` (no
		// every scanned dep via require.resolve, which throws
		// ERR_PACKAGE_PATH_NOT_EXPORTED ("No exports main defined") on such
		// packages under Node 24 and fails `npm install`. The template must
		// scope extraction so unrelated packages are never resolved.
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { empty: true, root: parent }, ['scoped-app'])
		const pkg = JSON.parse(readFileSync(join(parent, 'scoped-app', 'package.json'), 'utf8'))
		assert.deepEqual(pkg.npmSkills?.consume?.only, ['@swelte/*'])
	})

	it('--yes/--no-interactive never prompt (defaults: app, empty, SPA)', async () => {
		for (const flag of ['yes', 'no-interactive']) {
			const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
			await run(parent, { [flag]: true, root: parent }, [`flag-${flag}`])
			assert.ok(existsSync(join(parent, `flag-${flag}`, 'package.json')))
			assert.ok(!existsSync(join(parent, `flag-${flag}`, 'src', 'routes', 'api')))
		}
	})

	it('--no-ssr forces SPA even without --empty', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		await run(parent, { 'no-ssr': true, root: parent }, ['no-ssr-app'])
		const pkg = JSON.parse(readFileSync(join(parent, 'no-ssr-app', 'package.json'), 'utf8'))
		assert.equal(pkg.dependencies['@swelte/ssr-qjs'], undefined)
	})
})
