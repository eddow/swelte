// `swelte build`: typecheck -> generate -> `vite build` -> `v -o` server binary.
// The V binary serves dist/ + API (single artifact, no Node at runtime).
// WASM step is a no-op until roadmap item 6 lands (dev fallback still in place).
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Ctx } from './types.js'
import { killPort, portFree, takePort, waitPort } from './dev.js'

export async function runBuild(ctx: Ctx): Promise<void> {
  const root = resolve(String(ctx.opts.root ?? process.cwd()))
  const outBinary = String(ctx.opts.output ?? join(root, 'dist', 'server'))
  const { resolveV, vVersion } = await import('../toolchain.js')
  const v = resolveV(import.meta.url)
  ctx.log(`V toolchain: ${vVersion(v)} (${v})`)
  ctx.log(`root ${root}`)
  // 1. v check: compile-check the project (server.v + generated routes/).
  try {
    const { swelte } = await import('../vite.js')
    const plug = swelte({}) as unknown as { configResolved?: (c: { root: string }) => void }
    plug.configResolved?.({ root })
    ctx.log('generated routes/ + .swelte/')
  } catch (e) {
    throw new Error(`codegen failed: ${(e as Error).message}`)
  }
  // `v -o <tmp> .` typechecks (0.5.2 has no `v check`); /dev/null is not
  // writable for V's output checks, so use a temp file and remove it.
  const typecheckBin = join(root, '.swelte', 'typecheck')
  const check = spawnSync(v, ['-o', typecheckBin, '.'], { cwd: root, encoding: 'utf8' })
  try { rmSync(typecheckBin, { force: true }) } catch { /* ignore */ }
  if (check.status !== 0) {
    throw new Error(`V typecheck failed:\n${check.stderr || check.stdout}`)
  }
  ctx.log('V typecheck: ok')
  // 2. WASM (roadmap item 6): not compiled yet — dev fallback stays.
  ctx.log('wasm: skipped (item 6 open — dev fallback in generated stubs)')
  // 3. vite build FIRST (it wipes dist/, incl. any binary inside it).
  const res = spawnSync('npx', ['vite', 'build'], { cwd: root, encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`vite build failed:\n${res.stderr || res.stdout}`)
  ctx.log('vite build: ok')
  // 4. `v -o` the server binary into dist/ AFTER the wipe (dist-adjacent,
  // never the project root).
  try {
    execFileSync(v, ['-o', outBinary, '.'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string }
    throw new Error(`v -o failed: ${err.stderr?.toString() ?? err.message}`)
  }
  ctx.log(`V binary: ${outBinary}`)
  // 5. Smoke: boot the binary, probe page + API, stop.
  const probePort = takePort(ctx.opts.port, 4173)
  await killPort(probePort, ctx.log)
  const child = (await import('node:child_process')).spawn(outBinary, [], {
    cwd: root,
    env: { ...process.env, PORT: String(probePort), SWELTE_DIST: 'dist' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logged = ''
  child.stderr?.on('data', (d: Buffer) => { logged += d.toString() })
  child.stdout?.on('data', (d: Buffer) => { logged += d.toString() })
  try {
    if (!(await waitPort(probePort, 15000))) throw new Error(`built binary did not listen on :${probePort} within 15s\n${logged}`)
    const page = execSync(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${probePort}/`, { encoding: 'utf8' }).trim()
    const api = execSync(
      `curl -s -m 5 -H 'accept: application/json' 'http://localhost:${probePort}/api/greet?payload=%22w%22'`,
      { encoding: 'utf8' }
    ).trim()
    if (page !== '200') throw new Error(`smoke page: HTTP ${page} (want 200)\n${logged}`)
    if (!api.includes('Hello')) throw new Error(`smoke api: unexpected body ${api}\n${logged}`)
    ctx.log(`smoke: page 200 + api ok (:${probePort})`)
  } finally {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 800))
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    try { execSync(`fuser -k ${probePort}/tcp 2>/dev/null || true`) } catch { /* ignore */ }
  }
  ctx.log(`build done: ${outBinary} + dist/`)
}
