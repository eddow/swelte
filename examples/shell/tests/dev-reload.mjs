// Isolated real dev/build coexistence; never touches the user's running app.
import assert from 'node:assert/strict'
import {mkdtemp,cp,symlink,readFile,writeFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createHash} from 'node:crypto'
import {projectRoot,freePort,sleep} from './harness.mjs'
import {openHeadless,evalJs,waitFor} from './cdp.mjs'
const root=await mkdtemp(join(tmpdir(),'shell-dev-reload-'))
const profile=await mkdtemp(join(tmpdir(),'shell-reload-chrome-'))
const cli=resolve(projectRoot,'../../engine/core/bin/swelte.js')
const log=[]
let dev, browser
const run=async(args)=>{
 const child=spawn(process.execPath,[cli,...args,'--root',root],{cwd:root,env:{...process.env,SWELTE_DB_PATH:join(profile,'test.db')},stdio:['ignore','pipe','pipe']})
 let out='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b)
 const [code]=await once(child,'exit');assert.equal(code,0,out);return out
}
const evidence={cycles:[],notes:'Actual dev process remains open during each production build; source fingerprints checked after backend edits.'}
try{
 for(const file of ['src','vite.config.ts','svelte.config.js','package.json','index.html'])await cp(join(projectRoot,file),join(root,file),{recursive:true})
 const config=join(root,'vite.config.ts')
 await writeFile(config,(await readFile(config,'utf8')).replace('export default defineConfig({', `export default defineConfig({ server: { fs: { allow: [${JSON.stringify(root)}, ${JSON.stringify(resolve(projectRoot,'../..'))}] } },`))
 await symlink(resolve(projectRoot,'../../node_modules'),join(root,'node_modules'),'dir')
 const port=await freePort(),backend=await freePort()
 dev=spawn(process.execPath,[cli,'dev','--root',root,'--port',String(port),'--backend',String(backend)],{cwd:root,env:{...process.env,SWELTE_DB_PATH:join(profile,'test.db')},stdio:['ignore','pipe','pipe']})
 dev.stdout.on('data',b=>log.push(String(b)));dev.stderr.on('data',b=>log.push(String(b)))
 const rpc=async(fn,args={})=>{const r=await fetch(`http://127.0.0.1:${backend}/`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({fn,args})});return r.json()}
 const expected=async()=>createHash('sha256').update((await Promise.all(['src/routes/+page.v','src/lib/backend/shell_tools.v','src/lib/backend/shell_fs.v'].map(p=>readFile(join(root,p),'utf8')))).join('\n')).digest('hex')
 const waitRevision=async(want)=>{
  for(let i=0;i<1200;i++){
   if(dev.exitCode!==null)throw new Error(log.join(''))
   try{const rev=await rpc('shell_revision');if(rev.backend_revision===want)return rev}catch{}
   await sleep(100)
  }
  throw new Error('reload timeout: '+log.join('').slice(-5000))
 }
 let before=await waitRevision(await expected())
 assert.equal((await fetch(`http://localhost:${port}/`)).status,200)
 browser=await openHeadless(`http://localhost:${port}/`,profile)
 for(let cycle=1;cycle<=3;cycle++){
  await run(['build'])
  const route=join(root,'src/routes/+page.v');await writeFile(route,(await readFile(route,'utf8'))+`\n// reload acceptance cycle ${cycle}\n`)
  const after=await waitRevision(await expected())
  assert.notEqual(before.boot_id,after.boot_id)
  assert.notEqual(before.backend_revision,after.backend_revision)
  assert.equal((await fetch(`http://localhost:${port}/`)).status,200)
  await rpc('exec',{cmd:`echo reload-marker-${cycle}`,caller:'human',op_id:'reload-'+cycle})
  evidence.cycles.push({cycle,before:before.backend_revision,after:after.backend_revision,bootChanged:true,uiStatus:200})
  await browser.cdp.send('Page.reload', {ignoreCache:true})
  await waitFor(browser.cdp, `document.querySelector('[data-testid="revision"]')?.dataset.backendRev === ${JSON.stringify(after.backend_revision)} && document.querySelector('[data-testid="revision"]')?.dataset.expectedBackendRev === ${JSON.stringify(after.backend_revision)}`,60000)
  await waitFor(browser.cdp, `document.body.innerText.includes('reload-marker-${cycle}')`)
  assert.equal(await evalJs(browser.cdp, `[...document.querySelectorAll('.screen .line .output')].filter(n=>n.textContent.includes('reload-marker-${cycle}')).length`),1,'one terminal output after reconnect')
  assert.equal(await evalJs(browser.cdp, `document.querySelectorAll('[data-tool-state="active"]').length`),0)
  evidence.cycles.at(-1).browserRevisionMatched=true
  evidence.cycles.at(-1).terminalFrames=1
  before=after;console.log('dev/build reload cycle',cycle,'PASS')
 }
 await writeFile(join(projectRoot,'../../docs/specs/shell-dev-reload-evidence-2026-11-24.json'),JSON.stringify(evidence,null,2)+'\n')
}catch(error){ console.error(log.join('').slice(-3000));if(browser)console.error(await evalJs(browser.cdp,`({revision:{...document.querySelector('[data-testid=revision]')?.dataset},body:document.body.innerText.slice(-3000)})`));throw error; }finally{
 await browser?.close()
 if(dev){dev.kill('SIGTERM');await Promise.race([once(dev,'exit'),sleep(5000)]);if(dev.exitCode===null)dev.kill('SIGKILL')}
 await rm(root,{recursive:true,force:true});await rm(profile,{recursive:true,force:true})
}
