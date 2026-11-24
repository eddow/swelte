import {writeEvidence} from './evidence-output.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {loadDotenv} from '@swelte/core/toolchain'
import {startNative,projectRoot,sleep} from './harness.mjs'
import {openHeadless,evalJs,waitFor,submitChat} from './cdp.mjs'
loadDotenv(projectRoot)
assert.ok(process.env.OPENROUTER_API_KEY,'live acceptance requires a server key')
const dir=await mkdtemp(join(tmpdir(),'shell-live-browser-'))
const server=await startNative({env:{SWELTE_DB_PATH:join(dir,'live.db'),SWELTE_DIST:'dist',SWELTE_SSR:'1',SHELL_AI_BASE_URL:'',SHELL_TEST_LEASE:''}})
let browser
const evidence={date:'2026-11-24',adapter:'openrouter',model:'openai/gpt-4o-mini',scenarios:[]}
try{
 const source=`localStorage.setItem('swelte-shell-ai-configs-v1',JSON.stringify([{id:'live',name:'Live acceptance',adapter:'openrouter',model:'openai/gpt-4o-mini',run:{}}]));localStorage.setItem('swelte-shell-ai-active-v1','live');`
 browser=await openHeadless(server.base+'/',join(dir,'chrome'),source)
 const cdp=browser.cdp
 evidence.revision=(await server.rpc('shell_revision')).body
 const ready=()=>waitFor(cdp,`!document.querySelector('button.sendbtn.is-stop')`,30000)
 const text=()=>evalJs(cdp,`document.body.innerText`)
 const latest=()=>evalJs(cdp,`[...document.querySelectorAll('.bubble-row.assistant')].at(-1)?.innerText??''`)
 for(const question of ['what is your pwd ?','Just tell me where our console is (pwd) and what we can find there','what is your pwd ?']){
  const start=performance.now();await submitChat(cdp,question);await ready()
  const body=await latest()
  assert.ok(body.includes(projectRoot.replace(/\/$/,'')),body)
  assert.ok(!/stream ended without terminal|send failed|backend\.shell_tools/.test(body),body)
  assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="active"]').length`),0)
  console.log('PASS',question);evidence.scenarios.push({question,elapsedMs:Math.round(performance.now()-start),passed:true})
 }
 await evalJs(cdp,`document.querySelector('.drivetoggle input').click()`)
 for(const [question,expected] of [['Please run echo live-approval-probe','live-approval-probe'],['Read https://example.com and briefly give me its title.','Example Domain']]){
  await submitChat(cdp,question)
  await waitFor(cdp,`!!document.querySelector('.gate-pending')`,30000)
  assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="pending"]').length`),1)
  await evalJs(cdp,`[...document.querySelectorAll('.gate-pending button')].find(b=>/approve/i.test(b.textContent)).click()`)
  await ready()
  await waitFor(cdp,`[...document.querySelectorAll('.bubble-row.assistant')].at(-1)?.innerText.includes(${JSON.stringify(expected)})`,30000)
  const body=await text();assert.ok(!/stream ended without terminal|resume failed|send failed/.test(body),body)
  console.log('PASS',question);evidence.scenarios.push({question,expected,approved:true,passed:true})
 }
 await submitChat(cdp,'Please inspect the current working directory again, using your tools.')
 await waitFor(cdp,`!!document.querySelector('button.sendbtn.is-stop')`)
 const start=performance.now();await evalJs(cdp,`document.querySelector('button.sendbtn.is-stop').click()`);await ready()
 const stopMs=performance.now()-start;assert.ok(stopMs<500)
 await sleep(1000)
 assert.equal(await evalJs(cdp,`document.querySelectorAll('[data-tool-state="active"],[data-tool-state="pending"]').length`),0)
 evidence.scenarios.push({question:'Stop live model work',elapsedMs:Math.round(stopMs),passed:true})
 await submitChat(cdp,'what is your pwd ?');await ready()
 assert.ok((await latest()).includes(projectRoot.replace(/\/$/,'')))
 evidence.scenarios.push({question:'pwd after Stop',passed:true})
 const cd=await server.rpc('exec',{cmd:'cd src',caller:'human',op_id:'live-cd'});assert.equal(cd.status,200)
 await submitChat(cdp,'what is your pwd ?');await ready();assert.ok((await latest()).includes(projectRoot+'src'))
 evidence.scenarios.push({question:'human cd src, then fresh pwd',passed:true})
 evidence.ui=await evalJs(cdp,`({...document.querySelector('[data-testid="revision"]').dataset})`)
 assert.equal(evidence.ui.backendRev,evidence.ui.expectedBackendRev)
 await writeEvidence('shell-live-browser-evidence',evidence)
 console.log('Live browser scenarios passed:',evidence.scenarios.length)
}catch(error){if(browser)console.error(await evalJs(browser.cdp,`document.body.innerText`));throw error;}finally{await browser?.close();await server.stop();await rm(dir,{recursive:true,force:true})}
