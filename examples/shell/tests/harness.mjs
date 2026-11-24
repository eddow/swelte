import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export async function freePort() {
 const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
 const port = server.address().port; await new Promise(r => server.close(r)); return port
}
export async function startNative({cwd = projectRoot, env = {}} = {}) {
 const port = await freePort(), base = `http://127.0.0.1:${port}`
 const child = spawn(projectRoot + 'dist/server', [], {cwd, env: {...process.env, ...env, PORT: String(port)}, stdio:['ignore','pipe','pipe']})
 let logs=''; child.stdout.on('data',b=>logs+=b); child.stderr.on('data',b=>logs+=b)
 const stop = async () => {
  if (child.exitCode !== null) return
  child.kill('SIGTERM'); await Promise.race([once(child,'exit'), sleep(2000)])
  if(child.exitCode===null){child.kill('SIGKILL');await once(child,'exit')}
 }
 for(let i=0;i<300;i++) {
  try{if((await fetch(base+'/',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({fn:'shell_revision',args:{}})})).ok) break}catch{}
  if(child.exitCode!==null) throw new Error(logs)
  await sleep(25)
  if(i===299){await stop();throw new Error('server readiness timeout: '+logs)}
 }
 const rpc = async(fn,args={})=>{
  const r=await fetch(base+'/',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({fn,args})})
  return {status:r.status, body:await r.json()}
 }
 const run = async(prompt, options={}, onEvent=()=>{})=>{
  const start=performance.now()
  const r=await fetch(base+'/?/ai_stream',{method:'POST',headers:{accept:'text/event-stream'},body:new URLSearchParams({adapter:'openrouter',model:'fixture',prompt,drive:'0',...options})})
  if(!r.ok) return {status:r.status,events:[],raw:await r.text(),elapsedMs:performance.now()-start}
  const reader=r.body.getReader(), decoder=new TextDecoder(), events=[]
  let pending='',raw=''
  for(;;){
   const {value,done}=await reader.read();const text=decoder.decode(value??new Uint8Array(),{stream:!done});raw+=text;pending+=text
   let at
   while((at=pending.indexOf('\n\n'))>=0){
    const frame=pending.slice(0,at);pending=pending.slice(at+2)
    const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n')
    if(data){const event=JSON.parse(data);events.push(event);await onEvent(event,performance.now()-start)}
   }
   if(done)break
  }
  return {status:r.status,events,raw,elapsedMs:performance.now()-start}
 }
 return {base,port,child,stop,rpc,run}
}
export const trace = run => run.events.filter(e=>e.envelope.kind==='shell.trace').map(e=>e.payload)
export const answer = run => run.events.filter(e=>e.envelope.kind==='text.delta').map(e=>e.payload.text).join('')
export const terminal = run => run.events.findLast(e=>e.envelope.kind==='terminal')?.payload
