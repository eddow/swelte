// Explicit network acceptance run. Uses the configured server key, never records it.
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {loadDotenv} from '@swelte/core/toolchain'
import {startNative,trace,answer,terminal,projectRoot} from './harness.mjs'
loadDotenv(projectRoot)
assert.ok(process.env.OPENROUTER_API_KEY,'OPENROUTER_API_KEY is required for live acceptance')
const model=process.env.SHELL_LIVE_MODEL??'openai/gpt-4o-mini'
const record={date:'2026-11-24',adapter:'openrouter',model,configuration:{run:'provider defaults'},starts:[],samples:[],failures:[]}
const context=[
 'user: Just tell me where our console is (pwd) and what we can find there',
 "assistant: Terminal access is disabled for this turn, so I can't run pwd / whoami for you right now. Please enable the terminal toggle, and then I'll run it and tell you where our console is.",
 'user: sorry - please do',
 'assistant: I will check the console location for you.'
]
for(let boot=0;boot<2;boot++){
 const temp=await mkdtemp(join(tmpdir(),'shell-live-'))
 const server=await startNative({env:{SWELTE_DB_PATH:join(temp,'live.db'),SWELTE_RATE_LIMIT:'1000',SHELL_AI_BASE_URL:'',SHELL_TEST_LEASE:'',SHELL_TEST_BUDGET_MS:''}})
 try{
  const revision=(await server.rpc('shell_revision')).body
  const bundle=(await readFile(projectRoot+'dist/index.html','utf8')).match(/assets\/index-[^" ]+\.js/)?.[0]
  record.starts.push({...revision,uiBundle:bundle,uiBundleHash:bundle?createHash('sha256').update(await readFile(projectRoot+'dist/'+bundle)).digest('hex'):null})
  for(const conversation of ['clean','existing']){
   let history=[...context]
   for(const scenario of ['S1','S2'])for(let attempt=0;attempt<5;attempt++){
    const question=scenario==='S1'?(attempt%2?'Where is our console?':'what is your pwd ?'):'Where are we and what files are here?'
    const prompt=conversation==='clean'?question:[...history,'user: '+question].slice(-11).join('\n')
    const run=await server.run(prompt,{adapter:'openrouter',model})
    const t=trace(run), starts=t.filter(e=>e.event==='tool.start'), end=t.findLast(e=>e.event==='turn.end')
    const text=answer(run), expected=scenario==='S1'?1:2
    const sample={boot,conversation,scenario,attempt,elapsedMs:Math.round(run.elapsedMs),modelRequests:end?.model_reqs,toolStarts:starts.length,toolLabels:starts.map(e=>e.reason),terminal:terminal(run),answer:text,passed:false}
    const errors=[]
    if(terminal(run)?.reason!=='completed')errors.push('not completed')
    if(starts.length!==expected)errors.push(`expected ${expected} tool starts`)
    if((end?.model_reqs??Infinity)>(scenario==='S1'?2:3))errors.push('model request budget')
    if(!text.includes(projectRoot.replace(/\/$/,'')))errors.push('cwd missing')
    if(scenario==='S2'&&!/README|src|tests/.test(text))errors.push('listing missing')
    if(run.events.some(e=>e.envelope.kind==='approval.request'))errors.push('unexpected approval')
    if(/backend\.shell_tools|<tool|enable.{0,20}toggle/i.test(text))errors.push('protocol or toggle leak')
    if(run.elapsedMs>(scenario==='S1'?15000:25000))errors.push('deadline')
    sample.passed=errors.length===0
    if(errors.length)record.failures.push({sample:record.samples.length,errors})
    record.samples.push(sample)
    console.log(`${boot} ${conversation} ${scenario} ${attempt}: ${sample.passed?'PASS':'FAIL'} ${sample.elapsedMs}ms ${sample.modelRequests} model requests / ${sample.toolStarts} tools`)
    if(conversation==='existing')history.push('user: '+question,'assistant: '+text.slice(0,2000))
   }
  }
 }finally{await server.stop();await rm(temp,{recursive:true,force:true})}
}
record.summary={}
for(const scenario of ['S1','S2']){
 const samples=record.samples.filter(s=>s.scenario===scenario), times=samples.map(s=>s.elapsedMs).sort((a,b)=>a-b)
 record.summary[scenario]={samples:samples.length,passed:samples.filter(s=>s.passed).length,p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)}
}
const output=process.env.SHELL_LIVE_EVIDENCE??projectRoot+'../../docs/specs/shell-live-evidence-2026-11-24.json'
await writeFile(output,JSON.stringify(record,null,2)+'\n')
console.log(JSON.stringify(record.summary))
assert.equal(record.failures.length,0,JSON.stringify(record.failures))
assert.ok(record.summary.S1.p95<=10000 && record.summary.S2.p95<=15000,'live latency gate')
