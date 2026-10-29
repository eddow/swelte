// `swelte preview`: run the built V binary only (vite-less prod run).
// Serves dist/ + API on one port. No Vite involved.
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Ctx } from './types.js'
import { killPort, takePort, waitPort } from './dev.js'

export async function runPreview(ctx: Ctx): Promise<void> {
  const root = resolve(String(ctx.opts.root ?? process.cwd()))
  const port = takePort(ctx.opts.port, 4173)
  const binary = String(ctx.opts.binary ?? join(root, 'dist', 'server'))
  if (!existsSync(binary)) {
    throw new Error(`no binary at ${binary} — run ‘swelte build’ first`)
  }
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    throw new Error(`no dist/index.html in ${root} — run ‘swelte build’ first`)
  }
  await killPort(port, ctx.log)
  ctx.log(`starting ${binary} on :${port} (dist/ + API, no Vite)`)
  let child: ChildProcess | null = spawn(binary, [], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SWELTE_DIST: 'dist' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[preview:${port}] ${d}`))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[preview:${port}] ${d}`))
  child.on('exit', (code) => {
    child = null
    ctx.log(`preview binary exited (code ${code})`)
  })
  if (!(await waitPort(port, 15000))) {
    try { child?.kill('SIGTERM') } catch { /* ignore */ }
    throw new Error(`preview binary did not listen on :${port} within 15s`)
  }
  ctx.log(`ready: http://localhost:${port}`)
  let stopping = false
  await new Promise<void>((resolveDone) => {
    const stop = () => {
      if (stopping) return
      stopping = true
      ctx.log('shutting down...')
      try { child?.kill('SIGTERM') } catch { /* ignore */ }
      try { execSync(`fuser -k ${port}/tcp 2>/dev/null || true`) } catch { /* ignore */ }
      setTimeout(() => {
        try { child?.kill('SIGKILL') } catch { /* ignore */ }
        resolveDone()
      }, 1200)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    if (process.stdin.isTTY) {
      ctx.log('shortcuts: [q]uit')
      const onKey = (chunk: Buffer) => {
        if ((chunk.toString()[0] ?? '').toLowerCase() === 'q') {
          try { process.stdin.off('data', onKey) } catch { /* ignore */ }
          stop()
        }
      }
      process.stdin.on('data', onKey)
      process.once('exit', () => { try { process.stdin.off('data', onKey) } catch { /* ignore */ } })
    }
  })
  try { process.stdin.pause() } catch { /* ignore */ }
  try { process.stdin.removeAllListeners('data') } catch { /* ignore */ }
}
