import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'

async function waitForFile(app, file) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (existsSync(join(app, file))) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`Native producer did not release resources: ${file}`)
}

async function upgrade(url) {
  const target = new URL(url)
  const socket = createConnection({ host: target.hostname, port: Number(target.port) })
  try {
    return await new Promise((resolve, reject) => {
      let header = ''
      socket.setTimeout(5000, () => reject(new Error('WebSocket handshake timed out')))
      socket.on('error', reject)
      socket.on('connect', () => socket.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`))
      socket.on('data', bytes => {
        header += bytes.toString('latin1')
        const end = header.indexOf('\r\n\r\n')
        if (end >= 0) resolve(header.slice(0, end))
      })
    })
  } finally { socket.destroy() }
}

export async function checkStreams(url, app) {
  const sse = await fetch(`${url}events?lang=fr`, { headers: { accept: 'text/event-stream' } })
  assert.equal(sse.status, 200)
  assert.equal(sse.headers.get('x-dogfood-guard'), 'yes')
  assert.equal(sse.headers.getSetCookie().length, 2)
  assert.match(await sse.text(), /data: fr/)
  const rejected = await fetch(`${url}events?deny=1`, { headers: { accept: 'text/event-stream' }, redirect: 'manual' })
  assert.equal(rejected.status, 303)
  const wsRejected = await upgrade(`${url}socket?deny=1`)
  assert.match(wsRejected, /^HTTP\/1\.1 303/)
  const ws = await upgrade(`${url}socket?lang=fr`)
  assert.match(ws, /^HTTP\/1\.1 101/)
  assert.match(ws, /X-Dogfood-Guard: yes/i)
  assert.equal([...ws.matchAll(/set-cookie:/gi)].length, 2)

  const post = (mode = '', extra = {}) => fetch(`${url}stream?mode=${mode}`, {
    method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: '{"ready":true}', ...extra,
  })
  const response = await post()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-ai1-run-id'), 'fixture-run')
  assert.equal(response.headers.get('x-dogfood-guard'), 'yes')
  assert.equal(response.headers.getSetCookie().length, 2)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read()
    assert.equal(done, false)
    text += decoder.decode(value, { stream: true })
  }
  assert.match(text, /event: delta\ndata: {"text":"hé🙂"}/)
  assert.doesNotMatch(text, /event: done/, 'first event must arrive before producer completion')
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  assert.equal(text, 'event: delta\ndata: {"text":"hé🙂"}\n\nevent: done\ndata: {}\n\n')
  const before = await post('fail-before')
  assert.equal(before.status, 409)
  assert.match(await before.text(), /before stream/)
  const after = await post('fail-after')
  assert.equal(after.status, 200)
  assert.match(await after.text(), /event: delta/)
  const controller = new AbortController()
  const cancellation = await post('cancel', { signal: controller.signal })
  await cancellation.body.getReader().read()
  controller.abort()
  await waitForFile(app, 'stream-cancelled')
  const idle = await post('idle')
  assert.match(await idle.text(), /event: delta/)
  await waitForFile(app, 'stream-idle-ended')
  console.log('PASS: guarded SSE/WS metadata; native POST streaming, UTF-8 framing, pre/post-start errors, disconnect and idle cleanup')
}
