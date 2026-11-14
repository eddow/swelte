import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

export async function checkStrictSsr(binary, app, runtimeEnv, port) {
  let log = ''
  const server = spawn(binary, [], { cwd: app, env: { ...runtimeEnv, PORT: String(port), SWELTE_SSR_STRICT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', bytes => { log = (log + bytes).slice(-16000) })
  server.stderr.on('data', bytes => { log = (log + bytes).slice(-16000) })
  try {
    const url = `http://127.0.0.1:${port}/`
    const deadline = Date.now() + 15000
    for (;;) {
      if (server.exitCode !== null) throw new Error(`Strict SSR server exited: ${log}`)
      try { await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1000) }); break } catch {
        if (Date.now() > deadline) throw new Error(`Strict SSR server did not start: ${log}`)
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    const request = query => fetch(`${url}?q=${query}`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(5000) })
    for (const query of ['render-fail', 'ssr-timeout', 'ssr-output']) {
      const response = await request(query)
      assert.equal(response.status, 500, `${query}: ${await response.clone().text()}`)
      const body = await response.text()
      assert.match(body, /expected SSR render failed/)
      assert.doesNotMatch(body, /private|<!doctype/i)
    }
    assert.match(log, /reason=timeout/)
    assert.match(log, /reason=output-limit/)
    const head = await request('ssr-head')
    assert.equal(head.status, 200)
    assert.equal((await head.text()).match(/name="head-proof" content="(x+)"/)?.[1].length, 10000)
    const healthy = await request('healthy')
    assert.equal(healthy.status, 200, log)
    console.log('PASS: strict native SSR render/timeout/output failures, head-buffer growth and recovery')
  } finally {
    if (server.exitCode === null) {
      const exit = once(server, 'exit')
      server.kill('SIGTERM')
      const timer = setTimeout(() => server.kill('SIGKILL'), 3000)
      await exit
      clearTimeout(timer)
    }
  }
}
