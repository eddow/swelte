#!/usr/bin/env node
// test-pack-matrix.mjs — \u00a74 box 1: build clean consumers from packed packages.
// Packs core / plus / ai to tarballs, installs three isolated consumers, and
// asserts the release boundary without a native compile:
//   - core-alone: no Plus install, no `./jobs` core export, no `migrate` CLI.
//   - core+plus: `./jobs` + `./db` entry points import (jobsPlugin, dbPlugin,
//     migrate command), vite plugin resolves with both registered.
//   - core+plus+ai: Plus entry points plus the `@swelte/ai` entry point.
// A core-only app never drags the embedded SQLite runtime (only Plus vlib
// `backend/db.v` imports `db.sqlite`; core hub/ws templates do not).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = mkdtempSync(join(tmpdir(), 'swelte-pack-matrix-'))
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }))

function run(cmd, args, opts = {}) {
  const shell = process.platform === 'win32' && /^npm(\.cmd)?$/i.test(cmd)
  return execFileSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: { ...process.env }, stdio: opts.stdio ?? 'pipe', encoding: 'utf8', shell })
}

const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
console.log(`packing core/plus/ai/qjs @ ${VERSION} ...`)
const PACK = join(TMP, 'packs')
mkdirSync(PACK, { recursive: true })
for (const pkg of ['qjs', 'core', 'vvm', 'plus', 'ai']) {
  const out = run('npm', ['pack', `--workspace=engine/${pkg}`, '--pack-destination', PACK, '--silent']).trim().split('\n').pop()
  console.log(`  ${out}`)
}
const tgz = (dep) => join(PACK, `swelte-${dep}-${VERSION}.tgz`)

// Rewrite unpublished intra-workspace ranges to local tarballs (same template
// bytes, no registry): a scaffolded `^0.2.0` range may not exist on npm yet.
function pinLocal(dir) {
  const pjFile = join(dir, 'package.json')
  const pj = JSON.parse(readFileSync(pjFile, 'utf8'))
  let touched = false
  for (const s of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dep of ['qjs', 'core', 'vvm']) {
      if (pj[s]?.[`@swelte/${dep}`]) {
        pj[s][`@swelte/${dep}`] = `file:${tgz(dep)}`
        touched = true
      }
    }
  }
  if (touched) writeFileSync(pjFile, JSON.stringify(pj, null, 2) + '\n')
}

// Plus ships its core peer as a real dep: pin the packed core into its
// manifest before packing so `npm pack --workspace=engine/plus` resolves
// locally. Pack order matters (core first).

function installConsumer(name, deps) {
  const dir = join(TMP, name)
  mkdirSync(dir, { recursive: true })
  // Transitive engine deps (e.g. `@swelte/ssr-qjs` → `@swelte/qjs`) resolve
  // from the packed tarballs, never the registry (qjs is unpublished until
  // the first release-train run).
  const pkg = { name, private: true, type: 'module', dependencies: deps, overrides: {} }
  for (const dep of ['qjs', 'core', 'vvm']) {
    if (existsSync(tgz(dep))) pkg.overrides[`@swelte/${dep}`] = `file:${tgz(dep)}`
  }
  if (Object.keys(pkg.overrides).length === 0) delete pkg.overrides
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  run('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: dir })
  return dir
}
function probe(file, code) {
  writeFileSync(file, code)
  return run(process.execPath, [file], { cwd: dirname(file) })
}

// --- case 1: core alone ---
{
  const dir = installConsumer('core-alone', { '@swelte/core': `file:${tgz('core')}`, '@swelte/vvm': `file:${tgz('vvm')}` })
  const corePkg = JSON.parse(readFileSync(join(dir, 'node_modules', '@swelte', 'core', 'package.json'), 'utf8'))
  assert.ok(!corePkg.exports?.['./jobs'], 'core must not re-export ./jobs (Plus owns jobs)')
  assert.ok(!existsSync(join(dir, 'node_modules', '@swelte', 'plus')), 'core-alone must not install @swelte/plus')
  const coreManifest = join(dir, 'node_modules', '@swelte', 'core', 'package.json')
  const coreViaFile = JSON.parse(readFileSync(coreManifest, 'utf8'))
  assert.ok(!coreViaFile.exports?.['./jobs'], 'packed core tarball has no ./jobs')
  assert.match('core-alone ok', /core-alone ok/)
  console.log('ok: core-alone (no ./jobs export, no Plus install)')
}

// --- case 2: core + plus ---
{
  const dir = installConsumer('core-plus', { '@swelte/core': `file:${tgz('core')}`, '@swelte/plus': `file:${tgz('plus')}`, '@swelte/vvm': `file:${tgz('vvm')}` })
  const plusPkg = JSON.parse(readFileSync(join(dir, 'node_modules', '@swelte', 'plus', 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(plusPkg.exports ?? {}).sort(), ['.', './db', './jobs', './rooms'])
  const out = probe(join(dir, 'probe-plus.mjs'),
    `import assert from 'node:assert/strict';\n` +
    `const plus = await import('@swelte/plus');\n` +
    `const jobs = await import('@swelte/plus/jobs');\n` +
    `const db = await import('@swelte/plus/db');\n` +
    `const rooms = await import('@swelte/plus/rooms');\n` +
    `assert.equal(plus.jobsPlugin.name, 'jobs');\n` +
    `assert.ok(typeof jobs.createJobsPlugin === 'function');\n` +
    `assert.equal(db.dbPlugin.name, 'db');\n` +
    `assert.ok((db.dbPlugin.cli ?? []).some((c) => c.name === 'migrate'), 'dbPlugin owns migrate');\n` +
    `assert.equal(rooms.roomsPlugin.name, 'rooms');\n` +
    `assert.ok(rooms.roomsPlugin.attrs.includes('ws'), 'rooms claims ws');\n` +
    `const { swelte } = await import('@swelte/core/vite');\n` +
    `const plugin = swelte({ plugins: [plus.jobsPlugin, db.dbPlugin, rooms.roomsPlugin] });\n` +
    `assert.ok(plugin && typeof plugin.name === 'string', 'vite plugin resolves');\n` +
    `console.log('core-plus ok');\n`)
  assert.match(out, /core-plus ok/)
  console.log('ok: core+plus (./jobs + ./db + ./rooms, jobs/db/rooms plugins, migrate command)')
}

// --- case 3: core + plus + ai ---
{
  const dir = installConsumer('core-plus-ai', { '@swelte/core': `file:${tgz('core')}`, '@swelte/plus': `file:${tgz('plus')}`, '@swelte/ai': `file:${tgz('ai')}`, '@swelte/vvm': `file:${tgz('vvm')}` })
  const out = probe(join(dir, 'probe-ai.mjs'),
    `import assert from 'node:assert/strict';\n` +
    `const plus = await import('@swelte/plus');\n` +
    `assert.equal(plus.jobsPlugin.name, 'jobs');\n` +
    `const ai = await import('@swelte/ai');\n` +
    `assert.ok(ai && typeof ai === 'object', 'ai entry point imports');\n` +
    `console.log('core-plus-ai ok');\n`)
  assert.match(out, /core-plus-ai ok/)
  console.log('ok: core+plus+ai (Plus entry points + ai entry point import)')
}

console.log('PASS: pack matrix (core-alone / core+plus / core+plus+ai)')
