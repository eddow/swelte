import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	patchReadme,
	renderDeployReadmeBlock,
	renderDockerfile,
	renderDockerignore,
	renderVercelignore,
	runDeploy,
} from './deploy.js'

const ctx = (
	root: string,
	rest: string[] = [],
	opts: Record<string, string | number | boolean> = {}
) => ({
	argv: [] as string[],
	opts: { root, ...opts } as Record<string, string | number | boolean>,
	rest,
	log: () => {},
	error: () => {},
})

describe('swelte deploy: config automater (setup only)', () => {
	it('renders SSR vs SPA Dockerfiles', () => {
		const ssr = renderDockerfile({
			target: 'vercel',
			dockerfile: 'Dockerfile.vercel',
			distDir: 'dist',
			ssr: true,
			appName: 'docs',
			rootRel: 'examples/docs',
		})
		assert.ok(ssr.includes('SWELTE_SSR=1'))
		assert.ok(ssr.includes('Dockerfile.vercel'))
		assert.ok(ssr.includes('Root Directory: examples/docs'))
		assert.ok(ssr.includes('FROM debian:stable-slim'))
		const spa = renderDockerfile({
			target: 'docker',
			dockerfile: 'Dockerfile',
			distDir: 'dist',
			ssr: false,
			appName: 'app',
			rootRel: '.',
		})
		assert.ok(!spa.includes('SWELTE_SSR=1'))
		assert.ok(spa.includes('docker build -t app'))
		assert.ok(renderDockerignore('Dockerfile.vercel').includes('!Dockerfile.vercel'))
		assert.ok(renderVercelignore('Dockerfile.vercel').includes('!package.json'))
	})
	it('init writes files + patches package.json, status ok, drift detected', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			writeFileSync(
				join(root, 'package.json'),
				JSON.stringify(
					{
						name: 't',
						scripts: { build: 'swelte build', 'build:local': 'swelte build --local' },
						dependencies: { '@swelte/ssr-qjs': '^0.1.5' },
					},
					null,
					2
				)
			)
			await runDeploy(ctx(root, ['init'], { target: 'vercel' }))
			assert.ok(existsSync(join(root, 'Dockerfile.vercel')))
			assert.ok(existsSync(join(root, '.dockerignore')))
			assert.ok(existsSync(join(root, '.vercelignore')))
			const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
				swelte: { targetOs: string }
				scripts: Record<string, string>
			}
			assert.equal(pkg.swelte.targetOs, 'linux')
			// no new scripts: exactly the two builds, untouched
			assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'build:local'])
			// README created with the managed deploy block
			const readme = readFileSync(join(root, 'README.md'), 'utf8')
			assert.ok(readme.includes('<!-- swelte:deploy -->'))
			assert.ok(readme.includes('vercel deploy --prod'))
			assert.ok(readme.includes('npm run build'))
			await runDeploy(ctx(root, ['status'], { target: 'vercel' }))
			writeFileSync(join(root, 'Dockerfile.vercel'), 'hand-edited\n')
			await assert.rejects(() => runDeploy(ctx(root, ['status'], { target: 'vercel' })), /drift/)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('docker target uses plain Dockerfile, no vercelignore', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't' }, null, 2))
			await runDeploy(ctx(root, [], { target: 'docker' }))
			assert.ok(existsSync(join(root, 'Dockerfile')))
			assert.ok(!existsSync(join(root, '.vercelignore')))
			const readme = readFileSync(join(root, 'README.md'), 'utf8')
			assert.ok(readme.includes('docker build -t t'))
			assert.ok(!readme.includes('vercel deploy'))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('existing user scripts are never touched', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			writeFileSync(
				join(root, 'package.json'),
				JSON.stringify({ name: 't', scripts: { build: 'custom-build', extra: 'x' } }, null, 2)
			)
			await runDeploy(ctx(root, ['init'], { target: 'vercel' }))
			const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
				scripts: Record<string, string>
			}
			assert.deepEqual(pkg.scripts, { build: 'custom-build', extra: 'x' })
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('README deploy block replaces the managed fence, keeps user prose', () => {
		const block = renderDeployReadmeBlock({
			target: 'vercel',
			dockerfile: 'Dockerfile.vercel',
			appName: 't',
			rootRel: 'examples/t',
		})
		assert.ok(block.includes('vercel deploy --prod'))
		assert.ok(block.includes('npm run build'))
		assert.ok(block.includes('Root Directory `examples/t`'))
		// standalone project: no Root Directory noise
		const solo = renderDeployReadmeBlock({
			target: 'vercel',
			dockerfile: 'Dockerfile.vercel',
			appName: 't',
			rootRel: null,
		})
		assert.ok(!solo.includes('Root Directory'))
		assert.ok(solo.includes('Dockerfile Path'))
		// create
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			assert.equal(patchReadme(join(root, 'README.md'), block, false), 'created')
			// idempotent
			assert.equal(patchReadme(join(root, 'README.md'), block, false), 'unchanged')
			// user prose before the marker survives a target switch
			const docker = renderDeployReadmeBlock({
				target: 'docker',
				dockerfile: 'Dockerfile',
				appName: 't',
				rootRel: '.',
			})
			writeFileSync(join(root, 'README.md'), `# t\n\nMy prose.\n\n${block}\n`)
			assert.equal(patchReadme(join(root, 'README.md'), docker, false), 'updated')
			const next = readFileSync(join(root, 'README.md'), 'utf8')
			assert.ok(next.includes('My prose.'))
			assert.ok(next.includes('docker build -t t'))
			assert.ok(!next.includes('vercel deploy'))
			// missing marker appends under ## Deploy
			writeFileSync(join(root, 'README.md'), '# t\n')
			assert.equal(patchReadme(join(root, 'README.md'), docker, false), 'updated')
			assert.ok(readFileSync(join(root, 'README.md'), 'utf8').includes('## Deploy'))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('rejects unknown targets with the supported list', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			await assert.rejects(() => runDeploy(ctx(root, [], { target: 'heroku' })), /vercel \| docker/)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('fly target writes Dockerfile + fly.toml with the platform contract', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			writeFileSync(
				join(root, 'package.json'),
				JSON.stringify({ name: 't', dependencies: { '@swelte/ssr-qjs': '^0.1.5' } }, null, 2)
			)
			await runDeploy(ctx(root, ['init'], { target: 'fly' }))
			assert.ok(existsSync(join(root, 'Dockerfile')))
			const toml = readFileSync(join(root, 'fly.toml'), 'utf8')
			assert.ok(toml.includes('app = "t"'))
			assert.ok(toml.includes('internal_port = 8131'))
			assert.ok(toml.includes('SWELTE_DIST'))
			const readme = readFileSync(join(root, 'README.md'), 'utf8')
			assert.ok(readme.includes('fly deploy'))
			await runDeploy(ctx(root, ['status'], { target: 'fly' }))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('railway target writes Dockerfile + railway.json (DOCKERFILE builder, $PORT)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't' }, null, 2))
			await runDeploy(ctx(root, ['init'], { target: 'railway' }))
			assert.ok(existsSync(join(root, 'Dockerfile')))
			const cfg = JSON.parse(
				readFileSync(join(root, 'railway.json'), 'utf8').replace(/^\/\/.*$/gm, '')
			) as { build: { builder: string; dockerfilePath: string } }
			assert.equal(cfg.build.builder, 'DOCKERFILE')
			assert.equal(cfg.build.dockerfilePath, 'Dockerfile')
			const readme = readFileSync(join(root, 'README.md'), 'utf8')
			assert.ok(readme.includes('railway up'))
			await runDeploy(ctx(root, ['status'], { target: 'railway' }))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('render target writes Dockerfile + render.yaml Blueprint', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			writeFileSync(
				join(root, 'package.json'),
				JSON.stringify({ name: 't', dependencies: { '@swelte/ssr-qjs': '^0.1.5' } }, null, 2)
			)
			await runDeploy(ctx(root, ['init'], { target: 'render' }))
			assert.ok(existsSync(join(root, 'Dockerfile')))
			const yaml = readFileSync(join(root, 'render.yaml'), 'utf8')
			assert.ok(yaml.includes('runtime: docker'))
			assert.ok(yaml.includes('dockerfilePath: ./Dockerfile'))
			assert.ok(yaml.includes('healthCheckPath: /'))
			assert.ok(yaml.includes('SWELTE_SSR'))
			const readme = readFileSync(join(root, 'README.md'), 'utf8')
			assert.ok(readme.includes('git push'))
			await runDeploy(ctx(root, ['status'], { target: 'render' }))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
	it('static target writes the shim, no Dockerfile', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-deploy-'))
		try {
			writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 't' }, null, 2))
			await runDeploy(ctx(root, ['init'], { target: 'static' }))
			assert.ok(!existsSync(join(root, 'Dockerfile')))
			assert.ok(existsSync(join(root, 'dist', '.swelte-static')))
			await runDeploy(ctx(root, ['status'], { target: 'static' }))
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
