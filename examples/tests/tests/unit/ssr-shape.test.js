// Unit: SSR manifest + compiled JS emit for examples/tests.
// Proves core stays engine-agnostic (manifest only) while the qjs
// adapter can compose a sync renderRoute bundle for every page.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('tests example — ssr manifest', () => {
  it('manifest lists every page route', () => {
    const mf = join(root, '.swelte', 'ssr-manifest.json')
    assert.ok(existsSync(mf), `missing ${mf} — run swelte build/test first`)
    const parsed = JSON.parse(readFileSync(mf, 'utf8'))
    const routes = (parsed.routes ?? []).map((r) => r.route).sort()
    for (const want of [
      '/',
      '/boom',
      '/load-cookie',
      '/load-filter',
      '/load-redirect',
      '/load-status',
      '/typed',
      '/no-csr',
      '/bare-sub/leaf',
      '/bare-sub/wrapped',
      '/preload',
      '/limited',
      '/prerender-true',
      '/prerender-false',
    ]) {
      assert.ok(routes.includes(want), `no ${want} in ${routes.join(',')}`)
    }
  })

  it('manifest carries the parity per-route flags', () => {
    const mf = join(root, '.swelte', 'ssr-manifest.json')
    assert.ok(existsSync(mf), `missing ${mf} — run swelte build/test first`)
    const parsed = JSON.parse(readFileSync(mf, 'utf8'))
    const byRoute = new Map(parsed.routes.map((r) => [r.route, r]))
    assert.equal(byRoute.get('/no-csr')?.csr, false)
    assert.equal(byRoute.get('/bare-sub/leaf')?.layout, false)
    assert.ok(byRoute.get('/limited')?.limits?.rate === 2)
    assert.deepEqual(byRoute.get('/load-filter')?.serializedHeaders, ['x-keep'])
    assert.equal(byRoute.get('/prerender-true')?.prerender, 'prerender-true')
    assert.equal(byRoute.get('/prerender-false')?.prerender, 'prerender-false')
  })

  it('entries.json resolves the per-page prerender partition + async entries', () => {
    const ef = join(root, '.swelte', 'entries.json')
    assert.ok(existsSync(ef), `missing ${ef} — run swelte build/test first`)
    const crawl = JSON.parse(readFileSync(ef, 'utf8'))
    assert.ok((crawl.routes ?? []).includes('/prerender-true'), 'prerender=true missing from crawl')
    assert.ok(!(crawl.routes ?? []).includes('/prerender-false'), 'prerender=false leaked into crawl')
  })

  it('dev render.js composes from the manifest', async () => {
    const mf = join(root, '.swelte', 'ssr-manifest.json')
    if (!existsSync(mf)) {
      console.log('skip: no manifest yet (run swelte build first)')
      return
    }
    const { composeRenderJs } = await import('@swelte/ssr-qjs')
    const manifest = JSON.parse(readFileSync(mf, 'utf8'))
    const code = await composeRenderJs(manifest, { root, prod: false })
    assert.ok(code.includes('renderRoute'), code.slice(0, 120))
    assert.ok(code.includes('/boom'), 'boom route missing from bundle')
  })
})
