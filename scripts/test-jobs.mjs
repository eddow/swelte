import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cronHarness, createJobsPlugin } from '../engine/core/dist/vite.js'
import { resolveV, resolveCC, toolchainEnv } from '../engine/core/dist/toolchain.js'

const root = resolve(import.meta.dirname, '..')
mkdirSync(join(root, 'tmp'), { recursive: true })
const scratch = mkdtempSync(join(root, 'tmp', 'durable-jobs-'))
const workers = []
const stop = async (child) => { if (child.exitCode !== null || child.signalCode !== null) return; const done = once(child, 'exit'); child.kill('SIGKILL'); await done }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const wait = async (test, label) => { const deadline = Date.now()+12000; while (Date.now()<deadline) { if (test()) return; await pause(25) } throw new Error(label) }
let log = ''
try {
  const app = join(scratch, 'app')
  mkdirSync(join(app, 'src/routes'), {recursive:true})
  writeFileSync(join(app, 'package.json'), '{"type":"module"}')
  writeFileSync(join(app, 'src/routes/+page.v'), "module page\n@[get]\npub fn ping() string { return 'ok' }")
  writeFileSync(join(app, 'src/app.v'), "module app\n@[cron('2s')]\npub fn persisted() { println('durable') }")
  const { swelte } = await import('../engine/core/dist/vite.js')
  const plugin = swelte({ plugins: [createJobsPlugin({durable:true})] })
  plugin.configResolved?.({root:app})
  await plugin.buildStart?.()
  const generated = join(app,'.swelte')
  execFileSync(resolveV(import.meta.url), ['-enable-globals','-cc',resolveCC(),'-path',`${generated}|@vlib|@vmodules`,'-o',join(scratch,'app-server'),join(generated,'server.v')], {env:toolchainEnv(),stdio:'pipe',timeout:120000})
  const fragment = cronHarness([{ name: 'persistent', every: '2s,retry=1', seconds: 2, retry: 1, fallible: true, body: `os.write_file('started-' + os.getpid().str() + '-' + time.now().unix_nano().str(), 'running')!\ntime.sleep(1200 * time.millisecond)` }], true)
  const source = `module main
import os
import time
${fragment.imports}
@[heap]
struct SwelteLifecycle {}
fn (state &SwelteLifecycle) begin() bool { return true }
fn (state &SwelteLifecycle) end() {}
fn (state &SwelteLifecycle) is_stopping() bool { return false }
fn swelte_wait_active(ms int, state &SwelteLifecycle) bool { time.sleep(ms * time.millisecond); return true }
struct SwelteReport { phase string path string status int message string }
fn swelte_report(event SwelteReport) {}
struct App { lifecycle &SwelteLifecycle }
${fragment.main}
fn main() { app := App{lifecycle: &SwelteLifecycle{}}
${fragment.mainInner}
time.sleep(60 * time.second)
}`
  writeFileSync(join(scratch, 'worker.v'), source)
  const binary = join(scratch, 'worker')
  execFileSync(resolveV(import.meta.url), ['-cc', resolveCC(), '-path', `${join(root, 'engine/core/vlib')}|@vlib|@vmodules`, '-o', binary, join(scratch, 'worker.v')], { env: toolchainEnv(), stdio: 'pipe', timeout: 120000 })
  const start = () => { const child = spawn(binary, [], { cwd: scratch, env: { ...toolchainEnv(), SWELTE_JOBS_PATH: join(scratch,'jobs.db') }, stdio: ['ignore','pipe','pipe'] }); workers.push(child); child.stderr.on('data', bytes => { log += bytes }); return child }
  const files = () => readdirSync(scratch).filter(file => file.startsWith('started-'))
  start(); start()
  await wait(() => files().length > 0, 'first durable job did not start: ' + log)
  await pause(200)
  assert.equal(files().length, 1, 'two instances must not execute the same deadline')
  const owner = Number(files()[0].split('-')[1])
  await stop(workers.find(worker => worker.pid === owner))
  await wait(() => files().length === 2, 'survivor did not reclaim crashed transaction: ' + log)
  const db = new DatabaseSync(join(scratch, 'jobs.db'))
  await wait(() => db.prepare('select last_run from swelte_jobs').get()?.last_run != null, 'completion was not persisted')
  await Promise.all(workers.map(stop))
  const before = files().length
  db.prepare('update swelte_jobs set next_run=?').run(Math.floor(Date.now()/1000)-20)
  start()
  await wait(() => files().length > before, 'restart did not catch up overdue schedule')
  await pause(200)
  assert.equal(files().length, before + 1, 'restart must coalesce missed intervals')
  db.close()
  console.log('PASS: durable cron harness, two-instance exclusion, crash recovery, persisted completion and restart catchup')
} catch (error) { console.error(log); throw error }
finally { await Promise.all(workers.map(stop)); rmSync(scratch, { recursive: true, force: true }) }
