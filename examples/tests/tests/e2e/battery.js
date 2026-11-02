// Single e2e battery for examples/tests: one set of asserts, two configs.
// No boot inside — thin drivers boot via config.dev/preview, then call
// the define* groups. Split: shared API/error always, SSR-only on build
// outputs, dev-only (SPA/WASM/HMR/restart) on dev.
//
// Groups take a lazy getState() so `it` bodies read base/runnable at test
// time (node:test registers `it` sync, `before()` fills state later).
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { get } from './helpers.js'

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

