// Unit: generated contract for examples/tests is loadable.
// Asserts every projected .d.ts fn exists in its generated stub JS
// (types <-> stubs parity) — same rule `swelte test` enforces.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const typesDir = join(root, '.swelte', 'types')
const genDir = join(root, '.swelte', 'generated')

function walkTypes(dir, rel, out) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    const fp = join(dir, e)
    try {
      if (statSync(fp).isDirectory()) {
        walkTypes(fp, rel + e + '/', out)
        continue
      }
    } catch {
      continue
    }
    if (e.endsWith('.d.ts')) out.push({ dts: fp, rel: rel + e })
  }
}

describe('tests example — generated contract', () => {
  it('types dir exists after generate', () => {
    assert.ok(existsSync(typesDir), `missing ${typesDir} — run swelte build/test first`)
  })

  it('every projected fn exists in its stub', () => {
    const files = []
    walkTypes(join(typesDir, 'routes'), 'routes/', files)
    walkTypes(join(typesDir, 'lib'), 'lib/', files)
    assert.ok(files.length > 0, 'no projected .d.ts files — run generate first')
    const missing = []
    for (const { dts, rel } of files) {
      const src = readFileSync(dts, 'utf8')
      const fns = [...src.matchAll(/^export (?:async )?function ([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)]
        .map((m) => m[1])
        .filter((f) => f !== 'mountSwelteRoute')
      if (!fns.length) continue
      const stub = join(genDir, rel.replace(/\.d\.ts$/, '.js'))
      if (!existsSync(stub)) {
        missing.push(`${rel}: no stub ${stub}`)
        continue
      }
      const js = readFileSync(stub, 'utf8')
      for (const fn of fns) {
        if (!js.includes(fn)) missing.push(`${rel}: ${fn} missing from stub`)
      }
    }
    assert.deepEqual(missing, [])
  })

  it('ping route projects + error boundary exists', () => {
    const ping = join(typesDir, 'routes', 'api', 'ping.d.ts')
    assert.ok(existsSync(ping), 'api/ping.v did not project — check generate')
    const src = readFileSync(ping, 'utf8')
    assert.ok(src.includes('ping'), src.slice(0, 200))
    assert.ok(existsSync(join(root, 'src', 'routes', '+error.svelte')), 'global +error.svelte missing')
  })
})
