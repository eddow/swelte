const sleep = ms => new Promise(r => setTimeout(r, ms))
function makeCdp(url) {
  // Node 26 has a global WebSocket; define the listener API the test uses.
  const ws = new WebSocket(url)
  if (typeof ws.addEventListener !== 'function') {
    ws.addEventListener = (t, h) => ws.addListener(t, h)
    ws.removeEventListener = (t, h) => ws.removeListener(t, h)
  }
  const pending = new Map()
  const listeners = new Set()
  const dispatch = (raw) => {
    const msg = JSON.parse(String(raw))
    for (const h of [...listeners]) { try { h({ data: raw }) } catch {} }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error('CDP: ' + JSON.stringify(msg.error).slice(0, 300)))
      else res(msg.result)
    }
  }
  let seq = 0
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => dispatch(ev.data)
  const send = async (method, params = {}) => {
    await open
    const id = ++seq
    const out = new Promise((res, rej) => pending.set(id, { res, rej }))
    ws.send(JSON.stringify({ id, method, params }))
    return out
  }
  return { ws, send, listeners, close: () => ws.close() }
}

async function evalJs(cdp, expression) {
  // CDP returns { id, result: { result: RemoteObject } } — unwrap twice.
  const { result } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const remote = result?.result ?? result
  if (remote?.subtype === 'error' || remote?.type === undefined) throw new Error('page eval failed: ' + JSON.stringify(result).slice(0, 500))
  if (remote.exceptionDetails) throw new Error('page eval: ' + JSON.stringify(remote.exceptionDetails).slice(0, 500))
  return remote.value
}

async function waitFor(cdp, expr, timeoutMs = 20000) {
  const start = Date.now()
  for (;;) {
    const v = await evalJs(cdp, expr)
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout: ' + expr.slice(0, 200))
    await sleep(250)
  }
}

async function submitChat(cdp, text) {
  return evalJs(cdp, `(async () => {
    const ta = document.querySelector('textarea.composerinput');
    if (!ta) return 'no-composer';
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    // Svelte 5 bind:value listens for input; the native setter alone does not notify.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
    await new Promise(r => setTimeout(r, 500));
    const btn = document.querySelector('form.composerbar button.sendbtn:not(.is-stop)');
    if (!btn || btn.disabled) return 'btn-disabled:' + (ta.value ?? '');
    btn.click();
    return 'sent:' + ta.value;
  })()`)
}


export { makeCdp, evalJs, waitFor, submitChat }

export async function openHeadless(url, profile, source='') {
 const {spawn}=await import('node:child_process')
 const chrome=spawn(process.env.CHROME_BIN??'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe']})
 let log=''
 const port=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Chrome startup: '+log)),10000)
  chrome.stderr.on('data',b=>{log+=b;const m=log.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);if(m){clearTimeout(timer);resolve(m[1])}})
 })
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
 const cdp=makeCdp(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
 const errors=[]; cdp.listeners.add(ev=>{const e=JSON.parse(ev.data);if(['Runtime.exceptionThrown','Log.entryAdded','Network.loadingFailed'].includes(e.method))errors.push(e.params)});
 await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Log.enable');await cdp.send('Network.enable')
 if(source)await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source})
 await cdp.send('Page.navigate',{url});await cdp.send('Page.bringToFront')
 try { await waitFor(cdp,`!!document.querySelector('textarea.composerinput')`) } catch(e) {
  const body=await evalJs(cdp,`document.documentElement.outerHTML.slice(0,3500)`);chrome.kill('SIGTERM');throw new Error('UI startup: '+body+'\nErrors: '+JSON.stringify(errors),{cause:e})
 }
 return {cdp,port,close:async()=>{cdp.close();chrome.kill('SIGTERM');await sleep(200);if(chrome.exitCode===null)chrome.kill('SIGKILL')}}
}
