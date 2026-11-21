#!/usr/bin/env node
// Portable native acceptance checks for the dev controller (requires the V toolchain).
import assert from 'node:assert/strict'
import { execFile, fork } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { DevBackend } from '../engine/core/dist/commands/dev-backend.js'
import { launchDevApplication } from '../engine/core/dist/commands/dev-control.js'
import { startDevVite } from '../engine/core/dist/commands/dev-vite.js'
import { portFree } from '../engine/core/dist/commands/dev.js'
import { needsGlobals, resolveV, toolchainEnv } from '../engine/core/dist/toolchain.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(repo, 'tmp'), { recursive: true })
const root = mkdtempSync(join(repo, 'tmp', 'dev-lifecycle-'))
const events = join(root, 'events')
mkdirSync(events)
mkdirSync(join(root, 'src/routes'), { recursive: true })
mkdirSync(join(root, 'src/lib'), { recursive: true })
writeFileSync(join(root, 'package.json'), '{"type":"module"}')
writeFileSync(join(root, 'index.html'), '<html><body>dev lifecycle</body></html>')
writeFileSync(join(root, 'svelte.config.js'), 'export default {}')
writeFileSync(join(root, 'vite.config.mjs'), `import {swelte} from '@swelte/core/vite'; export default {plugins:[swelte()]}`)
const route = (value) => `module ping
import os
import time
@[get]
pub fn ping(req SwelteRequest) string {
 if (req.query['slow'] or { '' }) != '' {
  os.write_file(os.join_path(os.getenv('EVENT_DIR'), 'admitted'), 'yes') or {}
  time.sleep(800 * time.millisecond)
  os.write_file(os.join_path(os.getenv('EVENT_DIR'), 'completed'), 'yes') or {}
 }
 return '${value}'
}`
const routeFile = join(root, 'src/routes/ping.v')
writeFileSync(routeFile, route('first'))
writeFileSync(join(root, 'src/app.v'), `module app
import os
import time
@[startup]
pub fn boot() ! {
 os.write_file(os.join_path(os.getenv('EVENT_DIR'), os.getpid().str() + '.startup'), 'yes')!
 time.sleep(os.getenv('STARTUP_MS').int() * time.millisecond)
}
@[shutdown]
pub fn cleanup() ! {
 os.write_file(os.join_path(os.getenv('EVENT_DIR'), os.getpid().str() + '.shutdown'), C.swelte_received_stop().str())!
}`)
async function freePort() {
 const server = createServer().listen(0, '127.0.0.1')
 await once(server, 'listening')
 const port = server.address().port
 await new Promise(resolveClose => server.close(resolveClose))
 return port
}
async function until(test, description) {
 const end = Date.now() + 15000
 while (!(await test())) {
  if (Date.now() >= end) throw new Error(`timed out: ${description}`)
  await new Promise(resolveWait => setTimeout(resolveWait, 25))
 }
}
const port = await freePort()
const uiPort = await freePort()
const v = resolveV(import.meta.url)
const exec = promisify(execFile)
const messages = []
let ui
let backend
let application
let buildGate
const instances = []
const forceCalls = []
let lostPid
const env = toolchainEnv({ PORT: String(port), EVENT_DIR: events, V_C_ERROR_BUG_REPORT_DISABLED: '1' })
async function build(generation) {
 await buildGate
 await ui.prepare()
 const binary = join(root, '.swelte', `candidate-${generation}${process.platform === 'win32' ? '.exe' : ''}`)
 try {
  await exec(v, [...(needsGlobals(join(root,'.swelte')) ? ['-enable-globals'] : []), '-o', binary, join(root,'.swelte/server.v')], {cwd:root, env, timeout:60000})
 } catch (error) {
  throw new Error(`compile failed: ${error.stderr ?? error.message}`)
 }
 return binary
}
const request = async (query = '') => (await fetch(`http://127.0.0.1:${port}/ping${query}`, {
 headers:{accept:'application/json'}, signal:AbortSignal.timeout(5000),
})).text()
try {
 ui = await startDevVite(root, uiPort, toolchainEnv({SWELTE_V_BACKEND_URL:`http://localhost:${port}`}))
 backend = new DevBackend({ build, launch:async (binary,generation) => {
  application = await launchDevApplication({file:binary}, {cwd:root,env,stdio:'ignore'}, {generation,shutdownMs:3000,log:m=>messages.push(m)})
  instances.push(application)
  const originalKill = application.child.kill.bind(application.child)
  application.child.kill = (...args) => { forceCalls.push(args); return originalKill(...args) }
  return application
 }, discard: binary => rm(binary,{force:true}),log:m=>messages.push(m) })
 await backend.restart()
 assert.ok(messages.some(message => /backend ready/.test(message)), messages.join('\n'))
 assert.match(await request(), /first/)
 const firstPid = application.child.pid
 let release
 buildGate = new Promise(resolveBuild => { release=resolveBuild })
 const replacement = backend.restart()
 assert.match(await request(), /first/, 'old server must remain available during compilation')
 writeFileSync(routeFile,route('second'))
 release()
 buildGate = undefined
 await replacement
 assert.notEqual(application.child.pid,firstPid)
 assert.equal(readFileSync(join(events,`${firstPid}.shutdown`),'utf8'),'0')
 assert.match(await request(), /second/)
 const secondPid = application.child.pid
 writeFileSync(routeFile,route('second').replace("return 'second'",'return undefined_build_symbol'))
 await backend.restart()
 assert.ok(messages.some(message => /compile failed/.test(message)))
 assert.equal(application.child.pid,secondPid)
 assert.match(await request(), /second/)
 assert.equal(existsSync(join(events,`${secondPid}.shutdown`)),false)
 writeFileSync(routeFile,route('second'))
 const slow = request('?slow=1')
 await until(()=>existsSync(join(events,'admitted')),'request admission')
 await backend.stop()
 assert.match(await slow,/second/)
 assert.equal(readFileSync(join(events,`${secondPid}.shutdown`),'utf8'),'0')
 assert.ok(existsSync(join(events,'completed')))
 assert.equal(forceCalls.length,0,'normal restart/quit must send no signals')
 assert.equal(await portFree(port),true)
 console.log('PASS: build before stop, failed-build preservation, native drain and exactly-once cleanup without signals')

 // A separate controller exits abruptly: its native child must stop on channel EOF.
 const binary = await build(99)
 const launcher = join(root,'controller.mjs')
 const controlUrl = pathToFileURL(join(repo,'engine/core/dist/commands/dev-control.js')).href
 writeFileSync(launcher, `import {launchDevApplication} from ${JSON.stringify(controlUrl)};
 const app=await launchDevApplication({file:process.env.TEST_BINARY},{env:process.env,stdio:'ignore'},{generation:99,shutdownMs:3000,log:()=>{}});
 await app.ready; process.send({pid:app.child.pid}); process.on('message',()=>process.exit(0));`)
 const owner = fork(launcher,[],{env:{...env,TEST_BINARY:binary},stdio:['ignore','ignore','inherit','ipc']})
 const ownerExit = once(owner,'exit')
 const [message] = await once(owner,'message')
 lostPid=message.pid
 owner.send('simulate-controller-crash')
 await ownerExit
 await until(()=>existsSync(join(events,`${lostPid}.shutdown`)),'orphan application cleanup')
 await until(()=>portFree(port),'orphan application port release')
 assert.equal(readFileSync(join(events,`${lostPid}.shutdown`),'utf8'),'0')
 lostPid=undefined
 console.log('PASS: controller loss triggers native cooperative shutdown')

 const booting = await launchDevApplication({file:binary},{cwd:root,env:{...env,STARTUP_MS:'250'},stdio:'ignore'},
  {generation:100,shutdownMs:3000,log:m=>messages.push(m)})
 instances.push(booting)
 await booting.stop('quit-during-startup')
 assert.equal(booting.child.exitCode,0)
 assert.equal(readFileSync(join(events,`${booting.child.pid}.shutdown`),'utf8'),'0')
 assert.equal(await portFree(port),true)
 console.log('PASS: quit during startup runs cleanup without starting an orphan listener')
} finally {
 await backend?.stop()
 await Promise.all(instances.map(instance=>instance.stop('test-cleanup')))
 if (lostPid) { try { process.kill(lostPid,'SIGKILL') } catch {} }
 await ui?.close()
 rmSync(root,{recursive:true,force:true})
}
