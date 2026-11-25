import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startNative,sleep,projectRoot} from './harness.mjs'
import {makeCdp,evalJs,waitFor,submitChat} from './cdp.mjs'

test('rendered inspection, completion, failures, replay, cancellation and two-tab control', {timeout:120000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'shell-browser-'))
 let mode='pwd', providerRequests=0
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c
  providerRequests++;const body=JSON.parse(raw), calls=(body.messages??[]).flatMap(m=>m.tool_calls??[])
  if(mode==='failure' && calls.length){res.writeHead(503);res.end('{}');return}
  if(mode==='slow')await sleep(1500)
  const call=(cmd,name='shell_query')=>({choices:[{message:{content:null,tool_calls:[{id:'call-'+calls.length,type:'function',function:{name,arguments:JSON.stringify({cmd})}}]}}]})
  let response
  if(mode==='action' && !raw.includes('Approved tool:')) response=call('echo approved','shell_exec')
  else if(!calls.length && mode!=='action')response=call('pwd')
  else if(mode==='both' && calls.length===1)response=call('ls')
  else response={choices:[{message:{content:`Console: ${projectRoot.replace(/\/$/,'')}${mode==='both'?' — README.md, src, tests':''}`}}]}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(response))
 })
 provider.listen(0,'127.0.0.1');await once(provider,'listening')
 const server=await startNative({env:{SWELTE_DB_PATH:join(dir,'test.db'),SWELTE_DIST:'dist',SWELTE_SSR:'1',OPENROUTER_API_KEY:'fixture',SHELL_AI_BASE_URL:`http://127.0.0.1:${provider.address().port}`}})
 let chrome,cdp,tab2
 try{
  chrome=spawn(process.env.CHROME_BIN??'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${join(dir,'profile')}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe']})
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Chrome startup timeout')),10000)
   chrome.stderr.on('data',b=>{const m=String(b).match(/ws:\/\/127\.0\.0\.1:(\d+)\//);if(m){clearTimeout(timer);resolve(m[1])}})
  })
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  cdp=makeCdp(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
  await cdp.send('Page.enable');await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('swelte-shell-ai-configs-v1',JSON.stringify([{id:'fixture',name:'Fixture',adapter:'openrouter',model:'fixture-tool',run:{}}]));localStorage.setItem('swelte-shell-ai-active-v1','fixture');`})
  await cdp.send('Page.navigate',{url:server.base+'/'})
  await cdp.send('Page.bringToFront')
  await waitFor(cdp,`!!document.querySelector('textarea.composerinput')`)
  await waitFor(cdp,`document.querySelector('[data-testid="revision"]')?.dataset.backendRev?.length===64`)
  assert.equal(await evalJs(cdp,`document.querySelector('[data-testid="revision"]').dataset.backendRev===document.querySelector('[data-testid="revision"]').dataset.expectedBackendRev`),true)
  const uiErrors=[]
  cdp.listeners.add(ev=>{const m=JSON.parse(ev.data);if(m.method==='Runtime.exceptionThrown')uiErrors.push(m.params.exceptionDetails.text)})
  const settled=async()=>waitFor(cdp,`!document.querySelector('button.sendbtn.is-stop')`)
  await submitChat(cdp,'what is your pwd ?');await settled()
  const firstBody = await evalJs(cdp,`document.body.innerText`)
  assert.ok(firstBody.includes(projectRoot.replace(/\/$/,'')),firstBody)
  assert.ok(!(await evalJs(cdp,`document.body.innerText`)).includes('stream ended without terminal'))
  assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="done"]').length`),1)
  // Record receipt -> next paint, while the actual frontend processes real SSE.
  await evalJs(cdp,`(() => {
   window.__receipts=[];window.__paint=[];const original=window.fetch.bind(window);
   window.fetch=async(url,init)=>{
    const response=await original(url,init);
    if(!String(url).includes('ai_stream') || !response.body)return response;
    let buffer='';const decoder=new TextDecoder();
    return new Response(response.body.pipeThrough(new TransformStream({transform(chunk,controller){
     buffer+=decoder.decode(chunk,{stream:true});let at;
     while((at=buffer.indexOf('\\n\\n'))>=0){const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);const line=frame.split('\\n').find(l=>l.startsWith('data:'));if(!line)continue;const e=JSON.parse(line.slice(5));if(e.payload?.event==='tool.result'){const receipt={id:e.payload.call_id,time:performance.now()};window.__receipts.push(receipt);const checkPaint=()=>{const r=receipt;const row=[...document.querySelectorAll('[data-tool-call-id]')].find(n=>n.dataset.toolCallId===r.id);const ms=performance.now()-r.time;if(row?.dataset.toolState==='done'||ms>250){window.__paint.push({ms,state:row?.dataset.toolState});}else requestAnimationFrame(checkPaint);};requestAnimationFrame(checkPaint);}}
     controller.enqueue(chunk);
    }})),{status:response.status,headers:response.headers});
   };return true;
  })()`)
  mode='both';await submitChat(cdp,'Where are we and what files are here?');await settled();await sleep(100)
  const paints=await evalJs(cdp,`window.__paint`)
  assert.equal(paints.length,2);assert.ok(paints.every(p=>p.state==='done'&&p.ms<250),JSON.stringify(paints))
  console.log('receipt-to-paint measurements:',JSON.stringify(paints))
  mode='failure';await submitChat(cdp,'inspect before provider failure');await settled()
  assert.ok((await evalJs(cdp,`document.body.innerText`)).includes('HTTP 503'))
  assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="active"]').length`),0)
  // Controlled SSE exercises the production event reducer in phase-specific cases.
  await evalJs(cdp,`(() => {
   const original=window.fetch.bind(window);window.__scenario=null;
   window.fetch=(url,init)=>{
    if(!String(url).includes('ai_stream')||!window.__scenario)return original(url,init);
    const scenario=window.__scenario;window.__scenario=null;
    return Promise.resolve(new Response(new ReadableStream({start(controller){
     let seq=0;const emit=(kind,payload,id)=>controller.enqueue(new TextEncoder().encode('event: '+kind+'\\ndata: '+JSON.stringify({envelope:{runId:'controlled',kind,seq:id??++seq},payload})+'\\n\\n'));
     const row={tool:{name:'shell_query'},callId:'controlled-'+Date.now(),label:'Read working directory'};
     emit('tool.progress',row);if(scenario==='replay')emit('tool.progress',row,seq);
     if(['final','replay'].includes(scenario))emit('shell.trace',{event:'tool.result',call_id:row.callId,failed:false});
     if(scenario==='replay'){emit('tool.progress',row);emit('text.delta',{text:'Completed once'});emit('terminal',{reason:'completed'});controller.close();}
     else if(scenario==='disconnect')controller.close();
     else init.signal.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')));
    }}),{headers:{'content-type':'text/event-stream'}}));
   };return true;
  })()`)
  for(const phase of ['tool','final']){
   await evalJs(cdp,`window.__scenario=${JSON.stringify(phase)}`);await submitChat(cdp,'Stop during '+phase)
   await waitFor(cdp,`!!document.querySelector('button.sendbtn.is-stop')`)
   const before=await evalJs(cdp,`document.querySelectorAll('[data-tool-state="done"]').length`)
   const t=performance.now();await evalJs(cdp,`document.querySelector('button.sendbtn.is-stop').click()`)
   await settled();assert.ok(performance.now()-t<500)
   assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="active"]').length`),0)
   if(phase==='final')assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="done"]').length`),before)
  }
  for(const phase of ['replay','disconnect']){
   await evalJs(cdp,`window.__scenario=${JSON.stringify(phase)}`);await submitChat(cdp,'Event '+phase);await settled()
   assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="active"]').length`),0)
  }
  mode='slow';await submitChat(cdp,'Stop during model request');await waitFor(cdp,`!!document.querySelector('button.sendbtn.is-stop')`)
  await evalJs(cdp,`document.querySelector('button.sendbtn.is-stop').click()`);await settled();await sleep(1600)
  mode='pwd';await submitChat(cdp,'pwd after Stop');await settled()
  assert.equal(await evalJs(cdp, `document.querySelector('.drivetoggle')`), null)
  mode='action'; // action fixture parks the approval (no toggle needed)
  await submitChat(cdp,'echo approved');await waitFor(cdp,`!!document.querySelector('.gate-pending')`)
  assert.equal(await evalJs(cdp,`[...document.querySelectorAll('[data-tool-state="pending"]')].length`),1)
  // Stop after execution but before a delayed approval acknowledgement must not
  // restart the model when the old acknowledgement eventually arrives.
  await evalJs(cdp,`(() => {const original=window.fetch.bind(window);window.__resumeReceived=false;window.fetch=async(url,init)=>{const res=await original(url,init);if(String(init?.body??'').includes('shell_tool_resume')){window.__resumeReceived=true;await new Promise(r=>setTimeout(r,700));}return res;};})()`)
  const beforeResume=providerRequests
  await evalJs(cdp,`[...document.querySelectorAll('.gate-pending button')].find(b=>/approve/i.test(b.textContent)).click()`)
  await waitFor(cdp,`window.__resumeReceived===true`)
  await evalJs(cdp,`document.querySelector('button.sendbtn.is-stop').click()`);await settled();await sleep(900)
  assert.equal(providerRequests,beforeResume,'late approval acknowledgement cannot resume a stopped turn')
  assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="pending"],[data-tool-state="active"]').length`),0)
  assert.equal(await evalJs(cdp, `document.querySelector('.drivetoggle')`), null)
  await submitChat(cdp,'echo approved again');await waitFor(cdp,`!!document.querySelector('.gate-pending')`)
  // A second real tab cannot take the first tab's driver; human input preempts it.
  const target2=await(await fetch(`http://127.0.0.1:${port}/json/new?${server.base}/`,{method:'PUT'})).json()
  tab2=makeCdp(target2.webSocketDebuggerUrl);await tab2.send('Runtime.enable');await tab2.send('Page.enable')
  await waitFor(tab2,`!!document.querySelector('textarea.composerinput')`)
  const fetchRpc=(fn,args)=>`fetch('/',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(${JSON.stringify({fn,args})})}).then(r=>r.status)`
  assert.equal(await evalJs(tab2,fetchRpc('shell_handoff',{holder:'second-tab'})),400)
  assert.equal(await evalJs(tab2,fetchRpc('exec',{cmd:'echo cross-tab-output',caller:'human',op_id:'cross-tab'})),200)
  await waitFor(cdp,`document.body.innerText.includes('cross-tab-output')`);await waitFor(tab2,`document.body.innerText.includes('cross-tab-output')`)
  await settled()
  assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="pending"],[data-tool-state="active"]').length`),0,'other-tab human input settles the parked turn')
  for(const op_id of ['repeat-1','repeat-2'])assert.equal(await evalJs(tab2,fetchRpc('exec',{cmd:'echo repeated-real-command',caller:'human',op_id})),200)
  const repeated=`[...document.querySelectorAll('.screen .line .output')].filter(n=>n.textContent.includes('repeated-real-command')).length===2`
  await waitFor(cdp,repeated);await tab2.send('Page.reload',{ignoreCache:true});await waitFor(tab2,repeated)
  assert.equal(uiErrors.length,0,JSON.stringify(uiErrors))
 }catch(error){if(cdp)console.error(await evalJs(cdp,`document.body.innerText`));throw error;}finally{
  cdp?.close();tab2?.close();if(chrome){chrome.kill('SIGTERM');await sleep(200);if(chrome.exitCode===null)chrome.kill('SIGKILL')}
  await server.stop();await new Promise(r=>provider.close(r));await rm(dir,{recursive:true,force:true})
 }
})
