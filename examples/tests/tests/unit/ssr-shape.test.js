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
    assert.ok(routes.includes('/'), `no / in ${routes.join(',')}`)
    assert.ok(routes.includes('/boom'), `no /boom in ${routes.join(',')}`)
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
