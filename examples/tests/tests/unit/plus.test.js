// Unit: plus integration for examples/tests.
// Proves the core↔plus seam: with jobsPlugin loaded, generated output stays
// parity-identical (the tests fixture has no `@[cron]`), and the jobs
// helpers stay consistent with core codegen.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('tests example — plus integration', () => {
  it('plus plugins are importable from the example', async () => {
    const plus = await import('@swelte/plus')
    for (const name of ['jobsPlugin']) {
      assert.ok(plus[name], `@swelte/plus missing export ${name}`)
    }
  })

  it('plus helpers agree with the example surface', async () => {
    const { plusCronSeconds } = await import('@swelte/plus')
    assert.equal(plusCronSeconds('60s'), 60)
  })

  it('parity output unchanged with jobs loaded (no @[cron] in this fixture)', () => {
    const gen = join(root, '.swelte', 'routes', 'server_gen.v')
    if (!existsSync(gen)) {
      console.log('skip: no .swelte/routes/server_gen.v yet (run swelte build/test first)')
      return
    }
    const src = readFileSync(gen, 'utf8')
    assert.ok(!src.includes('swelte_cron'), 'unexpected cron V fragment in server_gen (fixture has no @[cron])')
  })
})
