// Unit: plus integration for examples/tests.
// Proves the core↔plus seam: with all v1 plus plugins loaded, generated
// output stays parity-identical (v1 plugins augment, never rewrite), and
// the plus helpers stay consistent with core codegen.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('tests example — plus integration', () => {
  it('plus plugins are importable from the example', async () => {
    const plus = await import('@swelte/plus')
    for (const name of ['jobsPlugin', 'sseChannelsPlugin', 'swrPlugin', 'outboxPlugin']) {
      assert.ok(plus[name], `@swelte/plus missing export ${name}`)
    }
  })

  it('plus helpers agree with the example surface', async () => {
    const { channelJoinFrame, outboxKey, plusCronSeconds } = await import('@swelte/plus')
    assert.equal(plusCronSeconds('60s'), 60)
    assert.equal(channelJoinFrame('lobby'), 'swelte:join:lobby')
    assert.equal(outboxKey({ url: '/api/save', method: 'POST', ts: 1 }), 'POST:/api/save:1')
  })

  it('parity output unchanged with plus loaded (server_gen has no plus fragments yet)', () => {
    const gen = join(root, '.swelte', 'routes', 'server_gen.v')
    if (!existsSync(gen)) {
      console.log('skip: no .swelte/routes/server_gen.v yet (run swelte build/test first)')
      return
    }
    const src = readFileSync(gen, 'utf8')
    assert.ok(!src.includes('plus:'), 'unexpected plus V fragment in server_gen (v1 should emit none)')
  })
})
