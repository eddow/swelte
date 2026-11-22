// §1 item 5: runtime lifecycle failure behavior for plugin init/cleanup.
// - failing second init: first runs, second throws (phase=startup-error),
//   third is skipped, boot never continues.
// - failing first cleanup: second still runs; the hook reports the FIRST
//   error only after all fragments complete.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, renderHarness } from '../engine/core/dist/gen/config.js'
import { resolveV, resolveCC, toolchainEnv } from '../engine/core/dist/toolchain.js'

const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(root, 'tmp', 'swelte-plugin-lifecycle-'))
const fromUrl = pathToFileURL(join(root, 'engine/core/dist/gen/config.js')).href
const cfg = await loadConfig(join(root, 'tmp'))
const prelude = 'module main\nimport os\n@[heap]\nstruct SwelteLifecycle {}\nfn (state &SwelteLifecycle) begin() bool { return true }\nfn (state &SwelteLifecycle) end() {}\nfn (state &SwelteLifecycle) is_stopping() bool { return false }\nstruct SwelteReport { phase string path string status int message string }\nfn swelte_report(event SwelteReport) { eprintln(event.phase + \' \' + event.message) }\nstruct App { lifecycle &SwelteLifecycle }\n'
const compile = (name, source) => {
  writeFileSync(join(scratch, `${name}.v`), source)
  const bin = join(scratch, name)
  execFileSync(resolveV(import.meta.url), ['-cc', resolveCC(), '-o', bin, join(scratch, `${name}.v`)], { env: toolchainEnv(), stdio: 'pipe', timeout: 120000, cwd: scratch })
  return bin
}
const run = (bin) => {
  const r = spawnSync(bin, [], { cwd: scratch, encoding: 'utf8', timeout: 10000 })
  return { status: r.status ?? 1, err: String(r.stderr ?? '') + String(r.stdout ?? '') }
}
try {
  // --- Case A: partial init ---
  const a = renderHarness(cfg, fromUrl, {}, [
    { mainInner: "os.write_file('first-init', 'yes')!" },
    { mainInner: "return error('second init failed')" },
    { mainInner: "os.write_file('third-init', 'yes')!" },
  ])
  const startA = a.indexOf('// [swelte] plugin init')
  const endA = a.indexOf('// [swelte] background-start')
  assert.ok(startA >= 0 && endA > startA, 'init blocks emitted')
  const srcA = `${prelude}fn main() {\nmut app := App{lifecycle: &SwelteLifecycle{}}\n${a.slice(startA, endA)}eprintln('BOOT-CONTINUED')\n}`
  const resA = run(compile('lc_init', srcA))
  assert.equal(existsSync(join(scratch, 'first-init')), true, 'first init ran')
  assert.equal(existsSync(join(scratch, 'third-init')), false, 'third init skipped after failure')
  assert.ok(resA.err.includes('startup-error') && resA.err.includes('second init failed'), `startup error reported (got ${JSON.stringify(resA.err.slice(0, 200))})`)
  assert.ok(!resA.err.includes('BOOT-CONTINUED'), 'boot did not continue')
  assert.notEqual(resA.status, 0, 'failing init exits nonzero')
  // --- Case B: failing first cleanup still runs the second ---
  const b = renderHarness(cfg, fromUrl, {}, [
    { shutdown: "return error('first cleanup failed')" },
    { shutdown: "os.write_file('second-cleaned', 'yes')!" },
  ])
  const shut = b.slice(b.indexOf('fn swelte_app_shutdown'), b.indexOf('fn swelte_run_shutdown'))
  const srcB = 'module main\nimport os\nstruct SwelteReport { phase string path string status int message string }\nfn swelte_report(event SwelteReport) { eprintln(event.phase + \' \' + event.message) }\n' + shut + '\nfn main() { swelte_app_shutdown() or { eprintln(\'SHUTDOWN-SEEN-FAIL\') }\nos.write_file(\'after-shutdown\', \'yes\')!\n}'
  const resB = run(compile('lc_shut', srcB))
  assert.equal(existsSync(join(scratch, 'second-cleaned')), true, 'second cleanup ran despite first failure')
  assert.ok(resB.err.includes('shutdown-error') && resB.err.includes('first cleanup failed'), `first cleanup error reported (got ${JSON.stringify(resB.err.slice(0, 200))})`)
  console.log('PASS: plugin lifecycle failure behavior (partial init, failing cleanup runs rest)')
} finally { rmSync(scratch, { recursive: true, force: true }) }
