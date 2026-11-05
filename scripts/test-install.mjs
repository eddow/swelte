#!/usr/bin/env node
// test-install.mjs — smoke-test the published init path in an isolated tmp dir.
// Packs engine/* to real tarballs, scaffolds via `swelte init` with deps
// rewritten to file: tarballs (same template bytes, local resolution, no
// registry, no publish needed), then `npm install` twice (SPA + SSR) with
// warnings and errors promoted to failures.
//
// Usage: node scripts/test-install.mjs [--keep]   (keeps tmpdir for debugging)
//
// Cross-platform (Windows-safe): pure node, no bash.
//
// Debugger safety: when run under an IDE inspector (VS Code auto-attach,
// NODE_OPTIONS=--inspect), the script respawns itself detached with the
// inspect flags stripped. Otherwise every child — and process.exit itself —
// blocks on "Waiting for the debugger to disconnect…".
import { spawnSync, execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv.includes('--help') || process.argv.includes('-h')) {
	console.log('Usage: node scripts/test-install.mjs [--keep]\n\nSmoke-test the published init path: packs engine/*, scaffolds SPA + SSR\ncases into a tmp dir, runs npm install with warnings promoted to failures.\n--keep preserves the tmp dir for debugging.')
	process.exit(0)
}

// --- debugger guard: respawn clean -----------------------------------------
function hasInspector() {
	const opts = process.env.NODE_OPTIONS ?? ''
	if (/(^|\s)--inspect(-brk)?(=\S*)?(\s|$)/.test(opts)) return true
	if (process.env.VSCODE_INSPECTOR_OPTIONS) return true
	return !!process.execArgv.some((a) => a.startsWith('--inspect'))
}
if (hasInspector() && !process.env.SWELTE_INSTALL_TEST_RESPAWNED) {
	const env = { ...process.env, SWELTE_INSTALL_TEST_RESPAWNED: '1' }
	delete env.NODE_OPTIONS
	delete env.VSCODE_INSPECTOR_OPTIONS
	const args = process.argv.slice(1)
	const child = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' })
	process.exit(child.status ?? 1)
}
// From here on the process is inspector-free (either it never had one,
// or this is the clean respawn).
const KEEP = process.argv.includes('--keep')

const TMP = mkdtempSync(join(tmpdir(), 'swelte-install-'))
process.on('exit', () => {
	if (KEEP) console.log(`kept: ${TMP}`)
	else rmSync(TMP, { recursive: true, force: true })
})

function fail(msg) {
	console.error(`FAIL: ${msg}`)
	process.exit(1)
}

// Children inherit this process's (now inspector-free) env directly.
const ENV = { ...process.env }

function run(cmd, args, opts = {}) {
	// Windows: npm is npm.cmd — execFile needs the shell to resolve it.
	const shell = process.platform === 'win32' && /^npm(\.cmd)?$/i.test(cmd)
	return execFileSync(cmd, args, {
		cwd: opts.cwd ?? ROOT,
		env: ENV,
		stdio: opts.stdio ?? 'pipe',
		encoding: 'utf8',
		shell,
		...opts.execOpts,
	})
}

const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
console.log(`packing engine/* @ ${VERSION} ...`)

// Core's dist must exist for the CLI + templates to pack.
run(process.execPath, ['-e', '1'], { stdio: 'ignore' }) // sanity: node works scrubbed
execSync('npm run build --workspace=@swelte/core', {
	cwd: ROOT,
	env: ENV,
	stdio: 'ignore',
	shell: process.platform === 'win32',
})

const PACK = join(TMP, 'packs')
mkdirSync(PACK, { recursive: true })
for (const pkg of ['core', 'vvm', 'ssr-qjs', 'mcp', 'plus']) {
	const out = run('npm', ['pack', `--workspace=engine/${pkg}`, '--pack-destination', PACK, '--silent'])
		.trim()
		.split('\n')
		.pop()
	console.log(`  ${out}`)
}

const tgz = (dep) => join(PACK, `swelte-${dep}-${VERSION}.tgz`)
if (!existsSync(tgz('core'))) fail(`missing ${tgz('core')}`)

async function installCase(name, initArgs) {
	const dir = join(TMP, name)
	console.log(`--- case: ${name} (${initArgs.join(' ')}) ---`)
	try {
		run(process.execPath, [join(ROOT, 'engine', 'core', 'bin', 'swelte.js'), 'init', dir, ...initArgs])
	} catch {
		fail(`init ${name}`)
	}
	// Rewrite every @swelte/* dep to its packed tarball BEFORE the first
	// install — a scaffolded `^0.2.0` range may not exist on the registry
	// yet (unpublished bump), and npm would fail resolving it. Same template
	// bytes, local resolution, no publish needed.
	for (const dep of ['core', 'vvm', 'ssr-qjs', 'mcp', 'plus']) {
		if (!existsSync(tgz(dep))) continue
		const pjFile = join(dir, 'package.json')
		const pj = JSON.parse(readFileSync(pjFile, 'utf8'))
		let touched = false
		for (const s of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
			if (pj[s]?.[`@swelte/${dep}`]) {
				pj[s][`@swelte/${dep}`] = `file:${tgz(dep)}`
				touched = true
			}
		}
		if (touched) writeFileSync(pjFile, JSON.stringify(pj, null, 2) + '\n')
	}
	// npm 11 blocks dep postinstalls without allowScripts — the template
	// pre-approves them, so any remaining warning is a real regression.
	let log
	try {
		log = run('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir })
	} catch (e) {
		const out = e.stdout ?? e.message ?? ''
		console.error(out.toString().split('\n').slice(-30).join('\n'))
		fail(`npm install ${name} (exit ${e.status ?? '?'})`)
	}
	if (/npm (warn|error)/i.test(log)) {
		console.error(log)
		fail(`npm install ${name} emitted warnings/errors`)
	}
	if (!existsSync(join(dir, '.agents', 'skills'))) fail(`${name}: .agents/skills missing`)
	if (!readdirSync(join(dir, '.agents', 'skills')).some((f) => f.includes('swelte-core-swelte-overview')))
		fail(`${name}: core skills not extracted`)
	console.log(`ok: ${name}`)
}

await installCase('spa', ['--empty'])
await installCase('ssr', ['--empty', '--ssr'])

console.log('PASS: install smoke (spa + ssr)')
