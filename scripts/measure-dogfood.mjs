#!/usr/bin/env node
// DF-17: repeatable native fixture measurements, with no comparison claims.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { arch, cpus, platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const stress = process.argv.includes('--stress')
const [appArg, outputArg] = process.argv.slice(2).filter(arg => arg !== '--stress')
if (!appArg) throw new Error('usage: node scripts/measure-dogfood.mjs <built fixture app> [report.json] [--stress]')
const app = resolve(appArg)
const binary = join(app, platform() === 'win32' ? 'server.exe' : 'server')
const buildFile = join(app, '.swelte/dogfood-build.json')
const build = existsSync(buildFile) ? JSON.parse(readFileSync(buildFile, 'utf8')) : null
const output = resolve(outputArg ?? join(app, 'native-measurements.json'))
assert.ok(statSync(binary).isFile(), 'build a retained test:dogfood fixture first (--keep)')
const probe = createServer()
probe.listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise((resolveClose, reject) => probe.close(error => error ? reject(error) : resolveClose()))
const url = `http://127.0.0.1:${port}/`
const started = performance.now()
const server = spawn(binary, [], {
  cwd: app,
  env: { ...process.env, PATH: '', PORT: String(port), SWELTE_DIST: join(app, 'dist'), SWELTE_SSR: '1', SWELTE_SSR_STRICT: '1', SWELTE_RATE_LIMIT: '100000', SWELTE_SSE_HEARTBEAT_MS: '100' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const exited = once(server, 'exit')
void exited.catch(() => {})
let log = ''
for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { log = (log + data).slice(-8000) })
let sampledPeakRssKiB = 0
function memory() {
  if (platform() !== 'linux') return null
  const status = readFileSync(`/proc/${server.pid}/status`, 'utf8')
  const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0)
  sampledPeakRssKiB = Math.max(sampledPeakRssKiB, rss)
  return { rssKiB: rss, highWaterKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0) }
}
const sampler = setInterval(() => { try { memory() } catch { /* process ended */ } }, 20)
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = q => Number(sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)].toFixed(3))
  return { samples: sorted.length, min: quantile(0), p50: quantile(0.5), p95: quantile(0.95), max: quantile(1) }
}
async function html(index) {
  const locale = ['en', 'fr', 'ro'][index % 3]
  const response = await fetch(`${url}?q=measurement&lang=${locale}`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /<title>Native package dogfood<\/title>/)
  assert.ok(body.includes(`name="dogfood-locale" content="${locale}"`))
  assert.doesNotMatch(body, /<!--ssr-body-->|data-swelte-render-error="1"/)
}
async function stream() {
  const start = performance.now()
  const response = await fetch(`${url}stream`, { method: 'POST', body: 'measure', signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200)
  const decoder = new TextDecoder()
  let body = '', firstEventMs
  for await (const bytes of response.body) {
    body += decoder.decode(bytes, { stream: true })
    if (firstEventMs === undefined && body.includes('\n\n')) firstEventMs = performance.now() - start
  }
  body += decoder.decode()
  assert.match(body, /event: delta\ndata: {"text":"hé🙂"}\n\n/)
  assert.match(body, /event: done\ndata: {}\n\n/)
  assert.ok(Number.isFinite(firstEventMs))
  return firstEventMs
}
async function batch(kind, concurrency, requests) {
  let next = 0
  const durations = [], firstEvents = []
  const start = performance.now()
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next++
      if (index >= requests) return
      const requestStart = performance.now()
      if (kind === 'html') await html(index)
      else firstEvents.push(await stream())
      durations.push(performance.now() - requestStart)
    }
  }))
  const elapsedMs = performance.now() - start
  return { kind, concurrency, requests, elapsedMs: Number(elapsedMs.toFixed(3)), requestsPerSecond: Number((requests * 1000 / elapsedMs).toFixed(3)), completionMs: summary(durations), ...(firstEvents.length ? { firstEventMs: summary(firstEvents) } : {}), memory: memory() }
}
async function roomCleanup(concurrency, round) {
  const room = `measurement-room-${round}`
  const listeners = async () => {
    const response = await fetch(`${url}listeners?name=${room}`, { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    return Number(await response.text())
  }
  const streams = await Promise.all(Array.from({ length: concurrency }, async () => {
    const response = await fetch(`${url}room?name=${room}`, { headers: { accept: 'text/event-stream' }, signal: AbortSignal.timeout(15000) })
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    let body = ''
    while (!body.includes('subscribed')) {
      const { value, done } = await reader.read()
      assert.equal(done, false)
      body += new TextDecoder().decode(value)
    }
    return reader
  }))
  // Each handler subscribes twice; both IDs must be reclaimed.
  assert.equal(await listeners(), concurrency * 2)
  await Promise.all(streams.map(reader => reader.cancel()))
  const deadline = Date.now() + 5000
  for (;;) {
    const remaining = await listeners()
    if (remaining === 0) break
    assert.ok(Date.now() < deadline, `room leaked ${remaining} subscriptions`)
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  return { concurrentSubscribers: concurrency, subscriptionsReleased: concurrency * 2 }
}
let report
try {
  for (;;) {
    assert.equal(server.exitCode, null, `native server exited during startup: ${log}`)
    try { await html(0); break } catch (error) {
      if (performance.now() - started > 15000) throw new Error(`native startup failed: ${error.message}\n${log}`)
      await new Promise(resolveWait => setTimeout(resolveWait, 5))
    }
  }
  const startupToFirstHtmlMs = performance.now() - started
  if (platform() === 'linux') assert.equal(realpathSync(`/proc/${server.pid}/exe`), realpathSync(binary))
  const readyMemory = memory()
  for (let i = 0; i < 8; i++) await html(i)
  const results = []
  const cleanup = []
  const rounds = stress ? 10 : 1
  for (let round = 1; round <= rounds; round++) {
    for (const concurrency of [1, 8, 32]) {
      results.push({ round, ...await batch('html', concurrency, 64) })
      results.push({ round, ...await batch('stream', concurrency, 32) })
    }
    if (stress) cleanup.push({ round, ...await roomCleanup(32, round) })
    console.log(`measurement: round ${round}/${rounds} passed`)
  }
  let nativeDependencies = null
  if (platform() === 'linux') nativeDependencies = execFileSync('ldd', [binary], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim())
  report = {
    measuredAt: new Date().toISOString(),
    scope: 'Loopback fixture only; Node drives requests outside the native server. No application-scale or comparative performance claim.',
    system: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    build,
    workload: { html: 'Guarded root load, installed native/UI dependency, locale metadata and strict embedded QuickJS SSR', stream: 'Native POST SSE: fragmented UTF-8 delta, 200ms producer delay, done event', rounds, roomCleanup: cleanup, warmupHtmlRequests: 8, rateLimitPerMinute: 100000, sseHeartbeatMs: 100, concurrency: [1, 8, 32], note: 'Includes fixture reporting/file I/O and cron. HTTP client connection reuse is Node fetch default; no TLS or provider/DB workload. Build optimization and versions are recorded when fixture metadata exists.' },
    runtimePathEmpty: true, binaryBytes: statSync(binary).size,
    startupToFirstHtmlMs: Number(startupToFirstHtmlMs.toFixed(3)),
    readyMemory, sampledPeakRssKiB, finalMemory: memory(), nativeDependencies, results,
  }
} finally {
  clearInterval(sampler)
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
  const timer = setTimeout(() => server.kill('SIGKILL'), 10500)
  try {
    const [code, signal] = await exited
    assert.equal(code, 0, `native shutdown failed (${signal ?? code}): ${log}`)
  } finally { clearTimeout(timer) }
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(`PASS: native runtime measurement report: ${output}`)
console.log(JSON.stringify({ startupToFirstHtmlMs: report.startupToFirstHtmlMs, readyMemory: report.readyMemory, sampledPeakRssKiB: report.sampledPeakRssKiB, results: report.results }))
