import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

function fixture(t) {
	const cwd = mkdtempSync(join(tmpdir(), 'swelte-release-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const dirs = ['engine/core', 'engine/mcp', 'engine/ssr-qjs', 'engine/vvm', 'engine/create', 'engine/plus',
		'examples/tests', 'examples/docs-site', 'examples/something', 'engine/create/templates/base']
	const paths = ['package.json', ...dirs.map((dir) => dir + '/package.json')]
	for (const path of paths) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true })
		copyFileSync(path, join(cwd, path))
	}
	// Pin the synthetic release line independently of the checkout under test.
	for (const path of paths) {
		const file = join(cwd, path)
		const manifest = JSON.parse(readFileSync(file, 'utf8'))
		if (path === 'package.json' || dirs.slice(0, 5).some((dir) => path === dir + '/package.json')) {
			manifest.version = '0.2.0'
			for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
				for (const name of Object.keys(manifest[section] ?? {})) {
					if (name.startsWith('@swelte/')) manifest[section][name] = '^0.2.0'
				}
			}
			for (const name of Object.keys(manifest.templateMinimums ?? {})) manifest.templateMinimums[name] = '0.2.0'
			writeFileSync(file, JSON.stringify(manifest))
		}
	}
	const npm = join(cwd, 'npm')
	writeFileSync(npm, `#!/bin/sh
case "$2" in
  *@[0-9]*) case "$EXACT" in
    timeout) echo "npm error code ETIMEDOUT" >&2; exit 1;;
    missing) echo "npm error code E404" >&2; exit 1;;
    *) echo "\${2##*@}";;
  esac;;
  *) echo "$LATEST";;
esac
`)
	chmodSync(npm, 0o755)
	const read = (path) => JSON.parse(readFileSync(join(cwd, path), 'utf8'))
	return {
		read,
		edit(path, edit) {
			const value = read(path)
			edit(value)
			writeFileSync(join(cwd, path), JSON.stringify(value))
		},
		snapshot: () => paths.map((path) => readFileSync(join(cwd, path), 'utf8')),
		run(args, registry = {}) {
			return spawnSync(process.execPath, [resolve('scripts/sync-version.mjs'), ...args], {
				cwd, encoding: 'utf8', env: { ...process.env, PATH: cwd + ':' + process.env.PATH, LATEST: '0.2.0', ...registry },
			})
		},
	}
}

test('sync and patch preserve reviewed internal dependency floors', (t) => {
	const f = fixture(t)
	f.edit('engine/mcp/package.json', (m) => { m.dependencies['@swelte/core'] = '^0.2.4' })
	for (const args of [[], ['patch', 'mcp']]) {
		const result = f.run(args)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(f.read('engine/mcp/package.json').dependencies['@swelte/core'], '^0.2.4')
	}
})

test('cut updates scaffold and engine floors, and refuses invalid state before writing', (t) => {
	const f = fixture(t)
	const cut = f.run(['line-cut', '0.3'])
	assert.equal(cut.status, 0, cut.stderr)
	assert.equal(f.read('engine/create/package.json').templateMinimums['@swelte/core'], '0.3.0')
	assert.equal(f.read('engine/core/package.json').dependencies['@swelte/vvm'], '^0.3.0')
	f.edit('engine/create/templates/base/package.json', (m) => { delete m.dependencies['@swelte/core'] })
	const before = f.snapshot()
	assert.equal(f.run(['line-cut', '0.4']).status, 1)
	assert.deepEqual(f.snapshot(), before)
	const gate = f.run(['check', '--json', '--mode', 'line-cut'])
	assert.equal(gate.status, 1)
	assert.deepEqual(JSON.parse(gate.stdout).publish, [])
})

test('registry failures, stale versions and tagged retries in both modes', (t) => {
	const f = fixture(t)
	for (const mode of ['single', 'line-cut']) {
		for (const [LATEST, EXACT, status, count] of [
			['0.1.9', 'timeout', 1, 0], ['0.2.1', 'exists', 1, 0], ['0.1.9', 'exists', 0, 0],
			['0.1.9', 'missing', mode === 'single' ? 1 : 0, mode === 'single' ? 0 : 5],
		]) {
			const result = f.run(['check', '--mode', mode, '--json'], { LATEST, EXACT })
			const report = JSON.parse(result.stdout)
			assert.equal(result.status, status, result.stdout)
			assert.equal(report.publish.length, count)
			assert.equal(report.registryError, EXACT === 'timeout')
		}
	}
})
