#!/usr/bin/env node
// Only creates/drops its own randomly named database; never migrates an app DB.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const name = `swelte_dogfood_${randomBytes(8).toString('hex')}`
let created = false
try {
  execFileSync('createdb', ['--template=template0', '--locale=C', name], { stdio: ['ignore', 'pipe', 'pipe'] })
  created = true
  const child = spawnSync(process.execPath, ['scripts/test-dogfood.mjs', '--postgres', ...process.argv.slice(2)], {
    cwd: root, env: { ...process.env, DATABASE_URL: `dbname=${name}` }, stdio: 'inherit',
  })
  process.exitCode = child.status ?? 1
  if (child.error) console.error(child.error.message)
} finally {
  if (created) execFileSync('dropdb', ['--force', name], { stdio: ['ignore', 'pipe', 'pipe'] })
}
