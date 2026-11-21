import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { runPackage } from './package.js'

function project() {
	const root = mkdtempSync(join(tmpdir(), 'swelte-package-'))
	mkdirSync(join(root, 'src/lib'), { recursive: true })
	writeFileSync(join(root, 'src/lib/index.ts'), 'export const answer: number = 42\n')
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify({
			name: 'test-package',
			version: '0.0.1',
			type: 'module',
			files: ['package'],
			exports: { '.': './package/index.js', './package.json': './package.json' },
		})
	)
	writeFileSync(
		join(root, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				target: 'ES2022',
				module: 'ESNext',
				moduleResolution: 'bundler',
				types: [],
			},
			include: ['src/lib'],
		})
	)
	return root
}

it('packages a route-free TS project and preserves application output', async () => {
	const root = project()
	try {
		mkdirSync(join(root, 'dist'))
		writeFileSync(join(root, 'dist/server'), 'application artifact')
		const { outDir } = await runPackage({ root })
		assert.equal(outDir, join(root, 'package'))
		assert.match(readFileSync(join(outDir, 'index.js'), 'utf8'), /answer = 42/)
		assert.match(readFileSync(join(outDir, 'index.d.ts'), 'utf8'), /answer/)
		assert.equal(readFileSync(join(root, 'dist/server'), 'utf8'), 'application artifact')
		assert.equal(existsSync(join(root, 'src/routes')), false)
		// Broken application sources must not participate in the library build.
		mkdirSync(join(root, 'src/routes'))
		writeFileSync(join(root, 'src/routes/+page.svelte'), '<script>invalid syntax!!</script>')
		await runPackage({ root })
		assert.equal(existsSync(join(outDir, 'routes')), false)
		const packed = JSON.parse(
			execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			})
		)[0]
		const paths = packed.files.map((file: { path: string }) => file.path)
		assert.ok(paths.includes('package/index.js'))
		assert.ok(paths.includes('package/index.d.ts'))
		assert.ok(
			paths.every((path: string) => !path.startsWith('src/routes/') && !path.startsWith('dist/'))
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

it('rejects publication metadata errors before overwriting output', async () => {
	const root = project()
	try {
		mkdirSync(join(root, 'package'))
		writeFileSync(join(root, 'package/keep'), 'previous build')
		const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
		manifest.files.push('src/routes')
		writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
		await assert.rejects(runPackage({ root }), /lib-routes-leak/)
		assert.equal(readFileSync(join(root, 'package/keep'), 'utf8'), 'previous build')
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

it('rejects output paths overlapping application, source or generated directories', async () => {
	const root = project()
	try {
		for (const output of [
			'dist',
			'dist/lib',
			'src',
			'src/lib',
			'.swelte/package',
			'.',
			'../outside',
			'node_modules/pkg',
		]) {
			await assert.rejects(runPackage({ root, output }), /output must be/)
		}
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

it('honors configured libDir, custom output and explicit input', async () => {
	const root = project()
	try {
		writeFileSync(
			join(root, 'svelte.config.js'),
			"export default { swelte: { libDir: 'shared', distDir: 'app-output' } }\n"
		)
		mkdirSync(join(root, 'shared'))
		writeFileSync(join(root, 'shared/index.ts'), 'export const shared = true\n')
		const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
		manifest.files = ['published']
		manifest.exports['.'] = './published/index.js'
		writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
		await runPackage({ root, output: 'published', types: false })
		assert.match(readFileSync(join(root, 'published/index.js'), 'utf8'), /shared = true/)
		await runPackage({ root, input: 'src/lib', output: 'published', types: false })
		assert.match(readFileSync(join(root, 'published/index.js'), 'utf8'), /answer = 42/)
		await assert.rejects(runPackage({ root, output: 'app-output' }), /output must be/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
