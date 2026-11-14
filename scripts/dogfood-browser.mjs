import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function browserExecutable() {
  if (process.env.SWELTE_TEST_BROWSER) return process.env.SWELTE_TEST_BROWSER
  const cache = join(homedir(), '.cache/ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter(name => name.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const file = join(cache, dir, sub)
        if (existsSync(file)) return file
      }
    }
  }
  for (const file of ['/usr/bin/chromium', '/usr/bin/google-chrome']) if (existsSync(file)) return file
  throw new Error('Set SWELTE_TEST_BROWSER to a Chromium executable for --browser')
}

export async function checkBrowser(url, scratch, staticUrl) {
  const browser = spawn(browserExecutable(), [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'browser')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let socket
  const pending = new Map()
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chromium did not expose DevTools')), 15_000)
      browser.on('error', reject)
      browser.stderr.on('data', chunk => {
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk))
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
      browser.on('exit', code => { clearTimeout(timer); reject(new Error(`Chromium exited: ${code}`)) })
    })
    socket = new WebSocket(endpoint)
    await once(socket, 'open')
    let id = 0
    const exceptions = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const entry = pending.get(message.id)
        if (!entry) return
        pending.delete(message.id)
        clearTimeout(entry.timer)
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
        else entry.resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    })
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)) }, 15_000)
      pending.set(requestId, { resolve, reject, timer })
      socket.send(JSON.stringify({ id: requestId, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const command = (method, params) => send(method, params, sessionId)
    await command('Page.enable')
    await command('Runtime.enable')
    await command('Page.addScriptToEvaluateOnNewDocument', { source: `
      globalThis.__swelteStrictHydration = true;
      globalThis.__dogfoodFallbacks = 0;
      addEventListener('swelte:hydration-fallback', () => __dogfoodFallbacks++);
      const observer = new MutationObserver(() => {
        const node = document.getElementById('context') || document.getElementById('item') || document.getElementById('item-error');
        if (node) { globalThis.__dogfoodSsrNode = node; observer.disconnect(); }
      });
      observer.observe(document, { childList: true, subtree: true });
    ` })
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const wait = async (expression, label) => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return
        if (exceptions.length) throw new Error(JSON.stringify(exceptions))
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error(`Browser condition failed: ${label}\n${await evaluate('document.body.innerText')}`)
    }
    await command('Page.navigate', { url: `${url}?q=first&lang=en` })
    await wait('!!globalThis.__swelteRoutes', 'router boot')
    assert.equal(await evaluate('globalThis.__dogfoodFallbacks'), 0)
    assert.equal(await evaluate('document.getElementById("context") === globalThis.__dogfoodSsrNode'), true)
    assert.equal(await evaluate('document.getElementById("context").textContent'), 'inherited context')
    assert.equal(await evaluate('document.getElementById("universal").textContent'), 'layout:en:first')
    await evaluate('document.getElementById("local").click(); document.getElementById("draft").value="keep me"; document.getElementById("draft").dispatchEvent(new Event("input", {bubbles:true})); document.getElementById("save").requestSubmit()')
    await wait('document.getElementById("validation")?.textContent === "required"', 'inline validation')
    await evaluate('document.getElementById("title").value="title"; document.getElementById("save").requestSubmit()')
    await wait('!!document.getElementById("saved")', 'mutation and refresh')
    assert.equal(await evaluate('document.getElementById("local").textContent'), 'Local 1')
    assert.equal(await evaluate('document.getElementById("draft").value'), 'keep me')
    assert.equal(await evaluate('location.search'), '?q=first&lang=en')
    assert.equal(await evaluate('document.getElementById("context") === globalThis.__dogfoodSsrNode'), true)
    await evaluate('document.getElementById("invalidate").click()')
    await wait('document.getElementById("refreshes")?.textContent === "1"', 'awaited tagged invalidation')
    assert.equal(await evaluate('document.getElementById("context") === globalThis.__dogfoodSsrNode'), true)
    await evaluate('document.getElementById("title").value="multipart"; const transfer=new DataTransfer(); transfer.items.add(new File([new Uint8Array([0,1,2,255])], "payload.bin")); document.getElementById("attachment").files=transfer.files; document.getElementById("save").requestSubmit(document.getElementById("upload"))')
    await wait('!!document.getElementById("uploaded")', 'multipart and submitter override')
    await evaluate('document.getElementById("cross-page").requestSubmit()')
    await wait('document.getElementById("cross-done")?.textContent === "true"', 'cross-page action completion')
    assert.equal(await evaluate('!!document.getElementById("unrelated")'), false)
    await evaluate('globalThis.__dogfoodOriginalFetch=globalThis.fetch; globalThis.__dogfoodHeld=false; globalThis.fetch=async (...args)=>{const response=await globalThis.__dogfoodOriginalFetch(...args); if(!globalThis.__dogfoodHeld && args[1]?.headers?.["X-Swelte-Load"]){globalThis.__dogfoodHeld=true; await new Promise(resolve=>{globalThis.__dogfoodRelease=resolve})} return response}; globalThis.__dogfoodRefresh=globalThis.__swelteRoutes.refresh(); void 0')
    await wait('globalThis.__dogfoodHeld', 'refresh held before committing')
    await evaluate('globalThis.__swelteRoutes.goto("/items/race?q=current&lang=fr")')
    await evaluate('globalThis.__dogfoodRelease(); globalThis.__dogfoodRefresh')
    assert.equal(await evaluate('document.getElementById("item").textContent'), 'race:current:fr')
    await evaluate('globalThis.fetch=globalThis.__dogfoodOriginalFetch; globalThis.__swelteRoutes.goto("/?q=first&lang=en")')
    await evaluate('globalThis.__dogfoodOriginalFetch=globalThis.fetch; globalThis.__dogfoodSaveStarted=false; globalThis.fetch=(...args)=>{if(String(args[0]).includes("/save")) globalThis.__dogfoodSaveStarted=true; return globalThis.__dogfoodOriginalFetch(...args)}; document.getElementById("title").value="slow"; document.getElementById("save").requestSubmit()')
    await wait('globalThis.__dogfoodSaveStarted', 'slow action dispatched')
    await evaluate('globalThis.__swelteRoutes.goto("/?q=slow")')
    await wait('document.getElementById("search")?.textContent === "slow"', 'navigation wins against action refresh')
    await evaluate('globalThis.fetch=globalThis.__dogfoodOriginalFetch')
    assert.equal(await evaluate('!!document.getElementById("saved")'), false)
    await evaluate('globalThis.__swelteRoutes.goto("/?q=first&lang=en")')
    await evaluate('globalThis.__dogfoodOriginalFetch=globalThis.fetch; globalThis.__dogfoodSaveStarted=false; globalThis.fetch=(...args)=>{if(String(args[0]).includes("/save")) globalThis.__dogfoodSaveStarted=true; return globalThis.__dogfoodOriginalFetch(...args)}; document.getElementById("title").value="slow"; document.getElementById("save").requestSubmit()')
    await wait('globalThis.__dogfoodSaveStarted', 'superseded action dispatched')
    await evaluate('document.getElementById("title").value=""; document.getElementById("save").requestSubmit()')
    await wait('!!document.getElementById("validation")', 'newer submission validation')
    await evaluate('new Promise(resolve=>setTimeout(resolve,350))')
    assert.equal(await evaluate('!!document.getElementById("saved")'), false)
    assert.equal(await evaluate('document.getElementById("validation").textContent'), 'required')
    await evaluate('globalThis.fetch=globalThis.__dogfoodOriginalFetch')
    await evaluate('(async () => { const earlier=globalThis.__swelteRoutes.goto("/?q=slow"); await new Promise(resolve=>setTimeout(resolve,50)); await globalThis.__swelteRoutes.goto("/?q=fast#hash"); await earlier })()')
    assert.equal(await evaluate('document.getElementById("search").textContent'), 'fast')
    assert.equal(await evaluate('location.hash'), '#hash')
    await evaluate('globalThis.__swelteRoutes.goto("/?q=universal-fail")')
    await wait('document.getElementById("page-error")?.textContent === "500: page load failed"', 'universal load error boundary')
    await evaluate('globalThis.__swelteRoutes.goto("/?q=load-fail")')
    await wait('document.getElementById("page-error")?.textContent.includes("403")', 'load error boundary')
    assert.equal(await evaluate('!!document.getElementById("save")'), false)
    await evaluate('globalThis.__swelteRoutes.goto("/?q=first&lang=en")')
    await evaluate('document.getElementById("query-link").click()')
    await wait('document.getElementById("layout-locale")?.textContent === "fr:next"', 'query navigation')
    assert.equal(await evaluate('document.getElementById("universal").textContent'), 'layout:fr:next')
    await evaluate('history.back()')
    await wait('document.getElementById("layout-locale")?.textContent === "en:first"', 'back navigation query')
    await evaluate('history.forward()')
    await wait('document.getElementById("layout-locale")?.textContent === "fr:next"', 'forward navigation query')
    await evaluate('globalThis.__swelteRoutes.goto("/static?lang=ro")')
    await wait('document.getElementById("static-locale")?.textContent === "ro"', 'UI-only inherited load')
    await evaluate('globalThis.__swelteRoutes.goto("/items/alpha?q=detail&lang=fr#section")')
    await wait('document.getElementById("item")?.textContent === "alpha:detail:fr"', 'dynamic route data')
    assert.equal(await evaluate('document.getElementById("item-route").textContent'), '/items/[id]')
    assert.equal(await evaluate('document.getElementById("item-param").textContent'), 'alpha')
    await evaluate('history.back()')
    await wait('document.getElementById("static-locale")?.textContent === "ro"', 'dynamic route back navigation')
    await evaluate('history.forward()')
    await wait('document.getElementById("item")?.textContent === "alpha:detail:fr"', 'dynamic route forward navigation')
    await command('Page.navigate', { url: `${url}items/${encodeURIComponent('café')}?q=direct&lang=ro` })
    await wait('!!globalThis.__swelteRoutes && document.getElementById("item")?.textContent === "café:direct:ro"', 'direct dynamic hydration with decoded params')
    assert.equal(await evaluate('globalThis.__dogfoodFallbacks'), 0)
    assert.equal(await evaluate('document.getElementById("item") === globalThis.__dogfoodSsrNode'), true)
    await evaluate('globalThis.__swelteRoutes.goto("/?deny=1")')
    await wait('location.search === "?login=1" && !!document.getElementById("save")', 'guard redirect')
    await evaluate('document.getElementById("title").value="explode"; document.getElementById("save").requestSubmit()')
    await wait('document.getElementById("page-error")?.textContent === "500: action unavailable"', 'action exception boundary')
    assert.equal(await evaluate('!!document.getElementById("save")'), false)
    assert.deepEqual(exceptions, [])
    if (staticUrl) {
      await command('Page.navigate', { url: `${staticUrl}/fr/article/caf%C3%A9` })
      await wait('!!globalThis.__swelteRoutes && document.getElementById("article")?.textContent === "Bonjour café"', 'static translated artifact hydration')
      assert.equal(await evaluate('globalThis.__dogfoodFallbacks'), 0)
      assert.equal(await evaluate('document.getElementById("article-url").textContent === location.href'), true, 'static initial URL must use the actual hosting origin')
      assert.equal(await evaluate('document.querySelector("link[rel=canonical]").href'), 'https://dogfood.example/fr/article/caf%C3%A9')
      assert.deepEqual(exceptions, [])
    }
    await command('Page.navigate', { url: `${url}items/denied?lang=fr` })
    await wait('!!globalThis.__swelteRoutes && document.getElementById("item-error")?.textContent === "Item 403: item denied"', 'direct nested error hydration')
    assert.equal(await evaluate('document.getElementById("item-error") === globalThis.__dogfoodSsrNode'), true)
    assert.equal(await evaluate('globalThis.__dogfoodFallbacks'), 0)
    assert.equal(await evaluate('document.getElementById("layout-locale").textContent'), 'fr:')
    await evaluate('globalThis.__swelteRoutes.goto("/items/alpha?lang=ro")')
    await wait('!!document.getElementById("item")', 'recover from nested boundary')
    await evaluate('globalThis.__swelteRoutes.goto("/items/denied?lang=ro")')
    await wait('document.getElementById("item-error")?.textContent === "Item 403: item denied"', 'client nested load error')
    assert.equal(await evaluate('document.getElementById("layout-locale").textContent'), 'ro:')
    assert.deepEqual(exceptions, [])
    await command('Page.addScriptToEvaluateOnNewDocument', { source: `
      const corrupt = new MutationObserver(() => {
        const root = document.querySelector('#app > [data-swelte-ssr]');
        if (root) { root.remove(); corrupt.disconnect(); }
      });
      corrupt.observe(document, { childList: true, subtree: true });
    ` })
    await command('Page.navigate', { url: `${url}?q=strict-hydration` })
    assert.equal(await evaluate('new Promise(resolve=>{const deadline=Date.now()+10000; const timer=setInterval(()=>{if(globalThis.__dogfoodFallbacks>0 || Date.now()>deadline){clearInterval(timer);resolve(globalThis.__dogfoodFallbacks>0)}},25)})'), true)
    assert.equal(await evaluate('!!globalThis.__swelteRoutes'), false, 'strict boot must not silently mount after hydration failure')
    assert.equal(await evaluate('!!document.getElementById("save")'), false)
    console.log('PASS: browser hydration, forms/refresh races, dynamic/history navigation, error boundaries and strict hydration rejection')
  } finally {
    socket?.close()
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('browser closed')) }
    if (browser.exitCode === null) {
      const exited = once(browser, 'exit')
      browser.kill('SIGTERM')
      const timer = setTimeout(() => browser.kill('SIGKILL'), 3000)
      await exited
      clearTimeout(timer)
    }
  }
}
