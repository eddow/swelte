// E2E dev config: boots `swelte dev` (config.dev.js), then runs the
// single battery — shared contract against the V backend + dev extras.
import { describe, before, after } from 'node:test'
import { startDev, stopDev } from './config.dev.js'
import { defineSharedContract, defineDevShell, defineDevMutations } from './battery.js'

describe('tests example — e2e dev (Vite + V backend + HMR)', () => {
  let s = { runnable: false }

  before(async () => { s = await startDev() })
  after(async () => { await stopDev(s) })

  defineSharedContract(() => ({ base: s.backendBase, runnable: s.runnable }), 'dev-backend')
  defineDevShell(() => s, 'dev')
  defineDevMutations(() => s, 'dev')
})
