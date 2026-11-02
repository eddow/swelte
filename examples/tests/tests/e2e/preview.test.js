// E2E preview config: boots per SERVE (config.preview.js), then runs the
// single battery — shared contract + SSR extras. SERVE=direct spawns
// dist/server; SERVE=preview (default) goes through the preview CLI.
import { describe, before, after } from 'node:test'
import { startPreview, stopPreview } from './config.preview.js'
import { defineSharedContract, defineSsrContract } from './battery.js'

describe('tests example — e2e preview (SERVE=direct|preview)', () => {
  let s = { runnable: false, mode: process.env.SERVE === 'direct' ? 'direct' : 'preview' }

  before(async () => { s = await startPreview() })
  after(async () => { await stopPreview(s) })

  const tag = () => `preview:${s.mode}`
  defineSharedContract(() => ({ base: s.base, runnable: s.runnable }), tag())
  defineSsrContract(() => ({ base: s.base, runnable: s.runnable }), tag())
})
