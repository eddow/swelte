// Boot config — preview: one battery, two serves.
// SERVE=direct spawns dist/server itself; SERVE=preview goes through the
// `swelte preview` CLI (auto SWELTE_SSR=1 when the bridge exists).
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, waitHttp, spawnChild, killChild } from './helpers.js'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const bin = join(root, '..', '..', 'engine', 'core', 'bin', 'swelte.js')
export const binary = join(root, 'dist', 'server')

export function serveMode() {
  return process.env.SERVE === 'direct' ? 'direct' : 'preview'
}

export async function startPreview() {
  const mode = serveMode()
  const state = { runnable: false, child: null, mode }
  const hasBuild = existsSync(binary) && existsSync(join(root, 'dist', 'index.html'))
  if (mode === 'direct') {
    if (!hasBuild) {
      console.log('skip: no dist/server — run swelte build first')
      return state
    }
  } else if (!(hasBuild && existsSync(bin))) {
    console.log('skip: preview e2e needs dist/server + built CLI')
    return state
  }
  const port = await freePort()
  state.base = `http://127.0.0.1:${port}`
  state.port = port
  if (mode === 'direct') {
    state.child = spawnChild(binary, [], {
      cwd: root,
      // Mirror `swelte preview` config forwarding (svelte.config.js
      // version stamp): the raw binary only stamps X-Swelte-Version
      // when SWELTE_VERSION is set — keep both serves identical.
      env: { PORT: String(port), SWELTE_DIST: 'dist', SWELTE_SSR: '1', SWELTE_VERSION: '9.9.9-test' },
    })
    await waitHttp(port, { ms: 15000 })
  } else {
    state.child = spawnChild(process.execPath,
      [bin, 'preview', '--port', String(port), '--root', root], { cwd: root })
    await waitHttp(port, { ms: 120000 })
  }
  state.runnable = true
  return state
}

export async function stopPreview(state) {
  await killChild(state?.child)
}
