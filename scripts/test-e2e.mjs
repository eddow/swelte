#!/usr/bin/env node
// test:e2e — folded native/integration checks, one build, sequential steps.
// Replaces the old cherry-picked commands (test:install, test:dev, test:images,
// test:pack-matrix, test:jobs, test:plugins): every suite stays available
// by direct invocation (e.g. `node scripts/test-jobs.mjs`), this runner is
// the single grouped entry point. Extra args are forwarded to every step
// (--keep keeps every scratch dir).
// Steps: install (packed SPA+SSR), dev lifecycle, images, pack matrix,
// jobs, plugin lifecycle.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extra = process.argv.slice(2)
const run = (step) => {
  console.log(`\n### e2e: ${step}`)
  const child = spawnSync(process.execPath, [`scripts/${step}.mjs`, ...extra], {
    cwd: root, stdio: 'inherit',
  })
  if (child.status !== 0) {
    console.error(`FAIL: e2e step ${step} exited ${child.status ?? '?'}`)
    process.exit(child.status ?? 1)
  }
}

for (const step of [
  'test-install',
  'test-dev-lifecycle',
  'test-images',
  'test-pack-matrix',
  'test-jobs',
  'test-plugin-lifecycle',
]) run(step)
console.log('\nPASS: e2e (install, dev lifecycle, images, pack matrix, jobs, plugin lifecycle)')
