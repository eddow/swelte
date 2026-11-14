import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

async function waitFor(check, label) {
  const deadline = Date.now() + 8000
  for (;;) {
    if (await check()) return
    assert.ok(Date.now() < deadline, label)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

export async function checkShutdown(binary, scratch, runtimeEnv, availablePort, postgres) {
  const failedCwd = join(scratch, 'shutdown-startup-failure')
  mkdirSync(failedCwd)
  const failure = spawnSync(binary, [], { cwd: failedCwd, env: { ...runtimeEnv, PORT: String(await availablePort()), SWELTE_TEST_STARTUP_FAIL: '1', SWELTE_TEST_MIGRATION_FAIL: '1' }, timeout: 10000 })
  assert.notEqual(failure.status, 0)
  assert.ok(!existsSync(join(failedCwd, 'dependent-plugin-started')))
  assert.ok(!existsSync(join(failedCwd, 'shutdown-hook')))

  for (const mode of ['drain', 'timeout', ...(!postgres ? ['hook-timeout', 'job-error'] : [])]) {
    const cwd = join(scratch, `shutdown-${mode}`)
    mkdirSync(cwd)
    const port = await availablePort()
    const url = `http://127.0.0.1:${port}/`
    let log = ''
    const server = spawn(binary, [], {
      cwd, env: { ...runtimeEnv, PORT: String(port), SWELTE_SHUTDOWN_TIMEOUT_MS: mode === 'drain' || mode === 'job-error' ? '3000' : '100', SWELTE_STREAM_IDLE_MS: '30000', SWELTE_TEST_ASSERT_SINGLE_CLEANUP: '1', SWELTE_TEST_SLOW_JOB: mode === 'drain' ? '1' : '0', SWELTE_TEST_SLOW_CLEANUP: mode === 'hook-timeout' ? '1' : '0', SWELTE_TEST_JOB_FAIL: mode === 'job-error' ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout.on('data', bytes => { log = (log + bytes).slice(-16000) })
    server.stderr.on('data', bytes => { log = (log + bytes).slice(-16000) })
    const exit = once(server, 'exit')
    let socket
    let repeat
    try {
      await waitFor(async () => {
        assert.equal(server.exitCode, null, log)
        try { return (await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(500) })).ok } catch { return false }
      }, 'shutdown server readiness')
      assert.ok(existsSync(join(cwd, 'dependent-plugin-started')))
      if (mode === 'drain') {
        const stream = await fetch(`${url}stream?mode=idle`, { method: 'POST', body: '{}', headers: { accept: 'text/event-stream' } })
        await stream.body.getReader().read()
        const room = await fetch(`${url}room?name=shutdown-room`, { headers: { accept: 'text/event-stream' } })
        await room.body.getReader().read()
        socket = new WebSocket(url.replace('http:', 'ws:') + 'socket?mode=room&name=shutdown-socket')
        socket.addEventListener('error', () => {})
        await once(socket, 'open')
        await waitFor(async () => (await (await fetch(`${url}listeners?name=shutdown-socket`, { headers: { accept: 'application/json' } })).json()) === 1, 'WS subscription readiness')
        const response = await fetch(`${url}?q=drain`, { headers: { accept: 'application/json', 'X-Swelte-Load': '1' } })
        assert.equal(response.status, 504)
      } else if (mode === 'timeout') {
        void fetch(`${url}?q=stuck`, { headers: { accept: 'application/json', 'X-Swelte-Load': '1' } }).catch(() => {})
        await waitFor(() => existsSync(join(cwd, 'load-started')), 'stuck load started')
      } else if (mode === 'job-error') {
        await waitFor(() => existsSync(join(cwd, 'job-report')), 'private job error reporting')
        assert.equal(readFileSync(join(cwd, 'job-report'), 'utf8'), 'private job detail')
        assert.doesNotMatch(log, /private job detail/)
      }
      const start = Date.now()
      server.kill('SIGTERM')
      if (mode === 'drain') repeat = setTimeout(() => server.kill('SIGTERM'), 50)
      const deadline = setTimeout(() => server.kill('SIGKILL'), 5000)
      const [code, signal] = await exit
      clearTimeout(deadline)
      assert.equal(signal, null, log)
      assert.equal(code, mode === 'drain' || mode === 'job-error' ? 0 : 1, log)
      if (mode === 'drain') {
        assert.ok(existsSync(join(cwd, 'load-finished')), log)
        assert.ok(existsSync(join(cwd, 'stream-idle-ended')), log)
        if (existsSync(join(cwd, 'cron-started'))) assert.ok(existsSync(join(cwd, 'cron-finished')), log)
        assert.ok(existsSync(join(cwd, 'shutdown-hook')), log)
        assert.match(log, /status=complete/)
      } else if (mode !== 'job-error') {
        assert.ok(Date.now() - start < 1500, log)
        assert.ok(!existsSync(join(cwd, 'shutdown-hook')), log)
        assert.match(log, /status=timeout/)
      }
      if (mode === 'job-error') assert.ok(existsSync(join(cwd, 'shutdown-hook')), log)
    } finally {
      clearTimeout(repeat)
      socket?.close()
      if (server.exitCode === null) { server.kill('SIGKILL'); await exit }
    }
  }
  console.log('PASS: startup-before-plugins; SIGTERM drains loads/jobs/streams/rooms before cleanup; bounded work/hook timeout')
}
