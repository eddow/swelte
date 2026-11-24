import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startNative, sleep, trace, terminal } from './harness.mjs'

test('watchdog, human preemption, lease contention', {timeout:30000}, async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'shell-recovery-'))
 let delay=0, received=0
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b
  received++;await sleep(delay)
  res.setHeader('content-type','application/json')
  res.end(JSON.stringify({choices:[{message:{content:'<tool shell_query {"cmd":"pwd"}>'}}]}))
 })
 provider.listen(0,'127.0.0.1');await once(provider,'listening')
 const env={SWELTE_DB_PATH:join(cwd,'test.db'),SHELL_AI_BASE_URL:`http://127.0.0.1:${provider.address().port}`,OPENROUTER_API_KEY:'fixture',SHELL_TEST_LEASE:'1',SHELL_TEST_BUDGET_MS:'350'}
 const server=await startNative({cwd,env})
 try{
  delay=1500
  const timed=await server.run('pwd')
  assert.equal(terminal(timed)?.reason,'failed')
  assert.ok(timed.elapsedMs<800, 'watchdog must bound the entire wait, not socket idle time')
  assert.equal(trace(timed).filter(t=>t.event==='tool.start').length,0)
  delay=1000
  const before=received
  const pending=server.run('read the console')
  for(let i=0;i<100 && received===before;i++)await sleep(10)
  assert.ok(received>before, 'provider should receive request: '+JSON.stringify(await Promise.race([pending,sleep(10).then(()=>({timed,received}))])))
  await server.rpc('shell_release',{holder:''})
  const cancelled=await pending
  assert.equal(terminal(cancelled)?.reason,'failed')
  assert.equal(trace(cancelled).filter(t=>t.event==='tool.start').length,0,'no tool may start after Stop')
  const holder='recovery-holder'
  assert.equal((await server.rpc('shell_handoff',{holder})).status,200)
  assert.equal((await server.rpc('shell_handoff',{holder:'second-tab'})).status,400)
  await server.rpc('exec',{cmd:'pwd',caller:'human',op_id:'human'})
  assert.equal((await server.rpc('shell_handoff',{holder:'second-tab'})).status,200)
  await server.rpc('shell_release',{holder:''})
 }finally{await server.stop();await new Promise(r=>provider.close(r));await rm(cwd,{recursive:true,force:true})}
})
