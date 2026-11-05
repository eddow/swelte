// Single e2e battery for examples/tests: one set of asserts, two configs.
// No boot inside — thin drivers boot via config.dev/preview, then call
// the define* groups. Split: shared API/error always, SSR-only on build
// outputs, dev-only (SPA/WASM/HMR/restart) on dev.
//
// Groups take a lazy getState() so `it` bodies read base/runnable at test
// time (node:test registers `it` sync, `before()` fills state later).
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { get, headRaw, wsConnect } from './helpers.js'

/** Parity battery (docs/specs/future.md §2): every shipped P0/P1/P2 item
 * with an HTTP-observable surface. Runs against build outputs (preview:
 * direct + CLI) and the V backend in dev (Vite HTML != SSR HTML, so these
 * assert dispatch/envelope behavior, not SSR markers).
 *
 * Browser-only halves stay in engine unit scope (sdk-errors.test.ts):
 * handleFetch rewrite, updated-store flip, preloadCode/goto/pushState/
 * captureSnapshot client nav, csr=false no-mount, layout-cut client nav.
 * What IS pinned here: status codes, envelope headers/cookies, manifest
 * + routes.js flags, and dist prerender artifacts.
 */
export function defineParityContract(getState, label = 'parity') {
  // Dispatch-level: provable against the bare V backend (dev) and the
  // built server (preview). No SSR renderer needed.
  const json = { accept: 'application/json' }

  // P0 item 3: typed errors keep their status; plain throws stay 400.
  it(`${label}: typed verb error keeps 403 (plain stays 400)`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const typed = await get(base + '/typed?deny', json)
    assert.equal(typed.status, 403)
    assert.ok((await typed.text()).includes('forbidden-typed'))
    const plain = await get(base + '/boom', json)
    assert.equal(plain.status, 400)
  })

  // P1 item 7, JSON half: @[error] sanitizes JSON error bodies.
  it(`${label}: @[error] sanitizes JSON error bodies`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const j = await get(base + '/typed?deny', json)
    assert.ok((await j.text()).includes('safe:forbidden-typed'))
  })

  // P0 item 4: version stamp on GET (every response carries it).
  it(`${label}: X-Swelte-Version stamped on responses`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/api/ping?payload=test', json)
    assert.equal(res.headers.get('x-swelte-version'), '9.9.9-test')
  })

  // P1 item 10, dispatch half: the cut leaf answers 200 (chrome asserts
  // need SSR HTML — see defineParitySsrContract).
  it(`${label}: layout-cut leaf dispatches 200`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const bare = await get(base + '/bare-sub/leaf?probe=1', json)
    assert.equal(bare.status, 200)
  })

  // P1 item 12: per-route rate limit fires on its own route.
  // The limiter is per-IP (shared bucket), so loop until 429 (limit 2
  // means at most a few hits) instead of asserting an exact ordinal.
  it(`${label}: per-route limits 429 /limited quickly`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    let capped = false
    for (let i = 0; i < 6 && !capped; i++) {
      const res = await get(base + '/limited?probe=' + i, json)
      if (res.status === 429) capped = true
      else assert.equal(res.status, 200)
      await res.text().catch(() => {})
    }
    assert.ok(capped, 'per-route rate limit never fired within 6 hits')
  })

  // P1 item 6 + P2 items: manifest + routes.js + dist artifacts.
  // Dev serves the V backend without dist/, so these assert where
  // `root` is provided and skip otherwise.
  it(`${label}: manifest/routes.js carry csr/layout/limits/serialized/prerender`, async () => {
    const { runnable, root } = getState()
    if (!runnable || !root) return
    const { existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const mf = join(root, '.swelte', 'ssr-manifest.json')
    if (!existsSync(mf)) {
      console.log('skip: no ssr-manifest (dev without generate?)')
      return
    }
    const parsed = JSON.parse(readFileSync(mf, 'utf8'))
    const byRoute = new Map(parsed.routes.map((r) => [r.route, r]))
    assert.equal(byRoute.get('/no-csr')?.csr, false, 'csr=false missing from manifest')
    assert.equal(byRoute.get('/bare-sub/leaf')?.layout, false, 'layout=false missing from manifest')
    assert.ok(byRoute.get('/limited')?.limits?.rate === 2, 'limits missing from manifest')
    assert.deepEqual(byRoute.get('/load-filter')?.serializedHeaders, ['x-keep'])
    assert.equal(byRoute.get('/prerender-true')?.prerender, 'prerender-true')
    const routesJs = join(root, '.swelte', 'routes.js')
    if (existsSync(routesJs)) {
      const js = readFileSync(routesJs, 'utf8')
      assert.ok(js.includes('csr: false'), 'csr:false missing from routes.js')
    }
  })

  it(`${label}: per-page prerender writes true, skips false`, async () => {
    const { runnable, root } = getState()
    if (!runnable || !root) return
    const { existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const distTrue = join(root, 'dist', 'prerender-true', 'index.html')
    if (!existsSync(distTrue)) {
      console.log('skip: no prerendered dist/prerender-true (needs swelte build with prerender crawl)')
      return
    }
    assert.ok(readFileSync(distTrue, 'utf8').includes('prerender-true'), 'prerendered HTML missing marker')
    assert.ok(!existsSync(join(root, 'dist', 'prerender-false', 'index.html')), 'prerender=false leaked into dist')
  })
}

/** SSR-level parity (docs/specs/future.md §2): asserts that need the SSR
 * renderer (load envelope on HTML navigations, +error HTML, reroute
 * content, layout chrome, link options, HEAD framing). Runs against build
 * outputs ONLY (preview: direct + CLI) — never against the dev backend,
 * which has no renderer by design (static/SPA/JSON when SWELTE_SSR_URL
 * is unset). Browser-only halves stay in engine unit scope
 * (sdk-errors.test.ts).
 */
export function defineParitySsrContract(getState, label = 'parity-ssr') {
  const html = { accept: 'text/html,application/xhtml+xml' }

  // P0 item 2: load envelope lands on the HTML navigation.
  it(`${label}: load-cookie sets header + cookie on HTML nav`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/load-cookie', html)
    const body = await res.text()
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-load-probe'), 'cookie-item')
    const setCookie = res.headers.raw?.['set-cookie'] ?? res.headers.get('set-cookie') ?? ''
    const joined = Array.isArray(setCookie) ? setCookie.join(', ') : String(setCookie)
    assert.ok(joined.includes('load_probe=envelope'), `missing load cookie: ${joined}`)
    assert.ok(body.includes('envelope-cookie'), body.slice(0, 300))
  })

  // P0 item 2: load-side status renders +error with that status.
  it(`${label}: load-status 404 renders +error HTML`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/load-status', html)
    assert.equal(res.status, 404)
    assert.ok((res.headers.get('content-type') ?? '').includes('html'))
  })

  // P0 item 2, redirect half: 3xx + Location, never an error page.
  it(`${label}: load-redirect answers 303 + Location`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/load-redirect', html)
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/')
  })

  // P2 item 2: serializedHeaders allowlist filters the envelope.
  it(`${label}: load-filter keeps x-keep, drops x-drop`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/load-filter', html)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-keep'), 'kept')
    assert.equal(res.headers.get('x-drop'), null)
    assert.ok((await res.text()).includes('filtered'), 'SSR props missing')
  })

  // P0 item 3, load half: thrown typed error keeps its status in +error HTML.
  it(`${label}: typed load error lands in +error HTML with 403`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/typed?mode=fail', html)
    assert.equal(res.status, 403)
    assert.ok((res.headers.get('content-type') ?? '').includes('html'))
    assert.ok((await res.text()).includes('safe:forbidden-typed'), 'sanitized load message missing from +error HTML')
  })

  // P1 item 7, HTML half: @[error] sanitizes HTML error bodies.
  it(`${label}: @[error] sanitizes HTML error bodies`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const h = await get(base + '/boom', html)
    assert.ok((await h.text()).includes('safe:boom'), 'HTML error not sanitized')
  })

  // reroute hook: /old-parity serves /.
  it(`${label}: @[reroute] rewrites /old-parity to /`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/old-parity', html)
    assert.equal(res.status, 200)
    assert.ok((await res.text()).includes('hello tests'), 'reroute did not serve /')
  })

  // P0 item 4, HEAD half: version stamp on HEAD (raw socket — veb's HEAD
  // framing trips node:http's strict parser even though headers are sent).
  it(`${label}: X-Swelte-Version stamped on HEAD`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const h = await headRaw(base + '/')
    assert.equal(h.status, 200)
    assert.equal(h.headers.get('x-swelte-version'), '9.9.9-test')
  })

  // P1 item 10: layout=false renders outside the wrapper chain.
  it(`${label}: layout cut omits wrapper chrome, control keeps it`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const bare = await get(base + '/bare-sub/leaf', html)
    assert.equal(bare.status, 200)
    const bareBody = await bare.text()
    assert.ok(!bareBody.includes('data-wrapper="bare-sub"'), 'wrapper leaked into cut page')
    assert.ok(bareBody.includes('bare leaf'), bareBody.slice(0, 300))
    const kept = await get(base + '/bare-sub/wrapped', html)
    assert.equal(kept.status, 200)
    assert.ok((await kept.text()).includes('data-wrapper="bare-sub"'), 'control lost its wrapper')
  })

  // P1 item 9: link preload/reload options survive SSR HTML.
  it(`${label}: data-sveltekit link options present in SSR HTML`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/preload', html)
    assert.equal(res.status, 200)
    const body = await res.text()
    assert.ok(body.includes('data-sveltekit-preload-data'), 'preload-data attr missing')
    assert.ok(body.includes('data-sveltekit-reload'), 'reload attr missing')
  })
}

/** Shared contract: JSON bypass + error pages + liveness.
 * getState() -> { base, runnable }. `base` is the built server in preview
 * and the V backend in dev (Vite HTML != SSR HTML, so SSR asserts never
 * run against Vite — see defineSsrContract). */
export function defineSharedContract(getState, label = 'shared') {
  it(`${label}: /api/ping stays JSON (SSR bypass)`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/api/ping?payload=test', { accept: 'application/json' })
    assert.equal(res.status, 200)
    const ct = res.headers.get('content-type') ?? ''
    assert.ok(ct.includes('json'), ct)
    const body = await res.text()
    assert.ok(body.includes('pong'), body.slice(0, 120))
  })

  it(`${label}: /nope renders +error HTML (not blank/JSON)`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/nope', { accept: 'text/html,application/xhtml+xml' })
    const body = await res.text()
    assert.equal(res.status, 404)
    assert.ok(body.includes('<main>'), body.slice(0, 300))
  })

  it(`${label}: /boom renders +error HTML, server stays up`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/boom', { accept: 'text/html,application/xhtml+xml' })
    const body = await res.text()
    assert.equal(res.status, 400)
    assert.ok((res.headers.get('content-type') ?? '').includes('html'))
    const again = await get(base + '/api/ping?payload=test', { accept: 'application/json' })
    assert.equal(again.status, 200)
  })
}
/** WS contract (future.md #3): echo round-trip + room fan-out over the hub.
 * getState() -> { base, runnable }. `base` is the built server in preview
 * and the V backend in dev (same WS upgrade path in both). Uses the raw
 * wsConnect() helper (masked client frames, __ping__ skip). */
export function defineWsContract(getState, label = 'ws') {
  it(`${label}: /api/ws-echo round-trips one text frame`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const url = base.replace(/^http/, 'ws') + '/api/ws-echo'
    const c = await wsConnect(url)
    try {
      const probe = `echo-${Date.now()}`
      c.send(probe)
      assert.equal(await c.nextMessage(), probe)
    } finally {
      await c.close()
    }
    // Non-upgrade GET on the socket path falls through to dispatch (not 101).
    const plain = await get(base + '/api/ws-echo', { accept: 'application/json' })
    assert.ok([404, 405].includes(plain.status), `want 404/405, got ${plain.status}`)
  })

  it(`${label}: /api/ws-rooms fans out to both subscribers`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const room = `room-${Date.now()}`
    const url = base.replace(/^http/, 'ws') + '/api/ws-rooms?room=' + encodeURIComponent(room)
    const a = await wsConnect(url)
    const b = await wsConnect(url)
    try {
      const msg = `hello-${Date.now()}`
      // Publish cross-request via the rpc arm on the same file.
      const r = await fetch(base + '/api/ws-rooms', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ fn: 'ws_say', args: { room, msg } }),
      })
      assert.ok(r.ok, `ws_say publish failed: ${r.status}`)
      assert.equal(await a.nextMessage(), msg)
      assert.equal(await b.nextMessage(), msg)
    } finally {
      await a.close()
      await b.close()
    }
  })
}



/** SSR-only: `/` must be server-rendered HTML with hydration marker and no
 * unfilled placeholder. Runs ONLY on build outputs — never on Vite dev. */
export function defineSsrContract(getState, label = 'ssr') {
  it(`${label}: / serves SSR HTML with hydration marker`, async () => {
    const { base, runnable } = getState()
    if (!runnable) return
    const res = await get(base + '/', { accept: 'text/html,application/xhtml+xml' })
    const body = await res.text()
    assert.equal(res.status, 200)
    assert.ok(body.includes('data-swelte-ssr="1"'), body.slice(0, 300))
    assert.ok(!body.includes('<!--ssr-body-->'), 'unfilled SSR marker leaked')
    assert.ok(body.includes('hello tests'), body.slice(0, 500))
  })
}

/** Dev-only: Vite SPA shell + RPC proxy + WASM module.
 * getState() -> { viteBase, backendBase, runnable }. */
export function defineDevShell(getState, label = 'dev') {
  it(`${label}: vite serves the SPA shell for page loads`, async () => {
    const { viteBase, runnable } = getState()
    if (!runnable) return
    const res = await get(viteBase + '/', { accept: 'text/html' })
    const body = await res.text()
    assert.equal(res.status, 200)
    assert.ok(body.includes('<div id="app"'), body.slice(0, 200))
  })

  it(`${label}: vite proxies JSON RPC to the V backend`, async () => {
    const { viteBase, backendBase, runnable } = getState()
    if (!runnable) return
    const direct = await get(backendBase + '/api/ping?payload=test', { accept: 'application/json' })
    assert.equal(direct.status, 200)
    assert.ok((await direct.text()).includes('pong'))
    const via = await get(viteBase + '/api/ping?payload=test', { accept: 'application/json' })
    assert.equal(via.status, 200, 'vite RPC proxy to V backend failed')
    assert.ok((await via.text()).includes('pong'))
  })

  it(`${label}: vite serves the WASM dev micro-module`, async () => {
    const { viteBase, runnable } = getState()
    if (!runnable) return
    const res = await get(viteBase + '/@swelte-dev/calc/add.wasm')
    assert.equal(res.status, 200, 'dev wasm micro-module missing')
    assert.ok((res.headers.get('content-type') ?? '').includes('wasm'))
    const buf = res._buf
    assert.ok(buf.length > 100, 'wasm payload suspiciously small')
    assert.equal(buf[0], 0x00)
    assert.equal(buf[1], 0x61)
  })
}

/** Dev-only mutations: .svelte HMR + V restart on .v touch.
 * getState() -> { viteBase, backendBase, runnable, root, pageFile }. */
export function defineDevMutations(getState, label = 'dev-hmr') {
  it(`${label}: .svelte edit updates the served module without restart`, async () => {
    const { viteBase, runnable, pageFile } = getState()
    if (!runnable) return
    const { readFileSync, writeFileSync } = await import('node:fs')
    const orig = readFileSync(pageFile, 'utf8')
    const marker = `hmr-${Date.now()}`
    const hmrUrl = viteBase + '/src/routes/+page.svelte'
    const before = await (await get(hmrUrl)).text()
    assert.ok(before.includes('swelte tests'), 'baseline module missing')
    const edited = orig.replace('swelte tests', marker)
    assert.notEqual(edited, orig, 'page has no heading to swap')
    writeFileSync(pageFile, edited)
    try {
      const deadline = Date.now() + 30000
      let seen = ''
      for (;;) {
        seen = await (await get(hmrUrl)).text()
        if (seen.includes(marker)) break
        if (Date.now() > deadline) break
        await new Promise((r) => setTimeout(r, 500))
      }
      assert.ok(seen.includes(marker), 'HMR did not pick up the edit')
    } finally {
      writeFileSync(pageFile, orig)
      const deadline = Date.now() + 30000
      for (;;) {
        const seen = await (await get(hmrUrl)).text()
        if (!seen.includes(marker)) break
        if (Date.now() > deadline) break
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  })

  it(`${label}: V still answers after a .v touch`, async () => {
    const { backendBase, runnable, root } = getState()
    if (!runnable) return
    const { join } = await import('node:path')
    const { readFileSync, writeFileSync } = await import('node:fs')
    const pingV = join(root, 'src', 'routes', 'api', 'ping.v')
    const orig = readFileSync(pingV, 'utf8')
    writeFileSync(pingV, orig + '\n')
    try {
      await new Promise((r) => setTimeout(r, 4000))
      const deadline = Date.now() + 60000
      let ok = false
      for (;;) {
        try {
          const res = await get(backendBase + '/api/ping?payload=test', { accept: 'application/json' })
          if (res.status === 200 && (await res.text()).includes('pong')) {
            ok = true
            break
          }
        } catch { /* restarting */ }
        if (Date.now() > deadline) break
        await new Promise((r) => setTimeout(r, 1000))
      }
      assert.ok(ok, 'V backend did not come back after .v restart')
    } finally {
      writeFileSync(pingV, orig)
      await new Promise((r) => setTimeout(r, 4000))
    }
  })
}

