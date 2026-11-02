// Boot config — dev: `swelte dev` via symlinked --root.
// Owns teardown traps: silent stdio + detached group kill live in
// helpers.js; the symlink keeps `pkill -f <basename>` off the runner.
import { existsSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort, waitHttp, spawnChild, killChild, get } from './helpers.js'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const bin = join(root, '..', '..', 'engine', 'core', 'bin', 'swelte.js')
export const pageFile = join(root, 'src', 'routes', '+page.svelte')

export async function waitViteHtml(port, ms = 90000) {
  const t0 = Date.now()
  for (;;) {
    try {
      const res = await get(`http://127.0.0.1:${port}/`, { accept: 'text/html' })
      const body = await res.text()
      if (res.status === 200 && body.includes('<div id="app"')) return body
    } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`vite did not serve HTML on :${port}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

export async function startDev() {
  const state = { runnable: false, dev: null, devRoot: '' }
  if (!(existsSync(bin) && existsSync(pageFile))) {
    console.log('skip: dev e2e needs built core CLI + page file')
    return state
  }
  const vitePort = await freePort()
  const backendPort = await freePort()
  state.vitePort = vitePort
  state.backendPort = backendPort
  state.viteBase = `http://127.0.0.1:${vitePort}`
  state.backendBase = `http://127.0.0.1:${backendPort}`
  state.devRoot = join(tmpdir(), `swelte-dev-probe-${vitePort}`)
  try {
    try { unlinkSync(state.devRoot) } catch { /* ignore */ }
    symlinkSync(root, state.devRoot, 'dir')
  } catch {
    state.devRoot = root
  }
  state.dev = spawnChild(process.execPath,
    [bin, 'dev', '--port', String(vitePort), '--backend', String(backendPort), '--root', state.devRoot],
    { cwd: root, silent: true })
  await waitHttp(backendPort, { ms: 90000 })
  await waitViteHtml(vitePort, 90000)
  state.runnable = true
  state.root = root
  state.pageFile = pageFile
  return state
}

export async function stopDev(state) {
  await killChild(state?.dev)
  try {
    if (state?.devRoot && state.devRoot !== root) unlinkSync(state.devRoot)
  } catch { /* ignore */ }
}
