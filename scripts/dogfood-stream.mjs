import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { join } from 'node:path'

async function bounded(promise, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000) })]) }
  finally { clearTimeout(timer) }
}

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
  const roomController = new AbortController()
  const room = await fetch(`${url}room?name=dogfood-room`, { headers: { accept: 'text/event-stream' }, signal: roomController.signal })
  const roomReader = room.body.getReader()
  const firstEvent = async () => {
    let text = ''
    while (!text.includes('subscribed')) {
      const { value, done } = await roomReader.read()
      assert.equal(done, false, text)
      text += new TextDecoder().decode(value)
    }
  }
  await bounded(firstEvent(), 'room subscription event timed out')
  assert.equal(await (await fetch(`${url}listeners?name=dogfood-room`, { headers: { accept: 'application/json' } })).json(), 2)
  roomController.abort()
  const roomDeadline = Date.now() + 5000
  for (;;) {
    const count = await (await fetch(`${url}listeners?name=dogfood-room`, { headers: { accept: 'application/json' } })).json()
    if (count === 0) break
    assert.ok(Date.now() < roomDeadline, 'idle SSE disconnect must remove all room subscriptions')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const sse = await fetch(`${url}events?lang=fr`, { headers: { accept: 'text/event-stream' } })
  assert.equal(sse.status, 200)
  assert.equal(sse.headers.get('x-dogfood-guard'), 'yes')
  assert.equal(sse.headers.getSetCookie().length, 2)
  assert.match(await sse.text(), /data: fr/)
  const empty = await fetch(`${url}events?mode=empty`, { headers: { accept: 'text/event-stream' } })
  assert.match(await empty.text(), /data: after-empty/)
  const rejected = await fetch(`${url}events?deny=1`, { headers: { accept: 'text/event-stream' }, redirect: 'manual' })
  assert.equal(rejected.status, 303)
  const wsRejected = await upgrade(`${url}socket?deny=1`)
  assert.match(wsRejected, /^HTTP\/1\.1 303/)
  const ws = await upgrade(`${url}socket?lang=fr`)
  assert.match(ws, /^HTTP\/1\.1 101/)
  assert.match(ws, /X-Dogfood-Guard: yes/i)
  assert.equal([...ws.matchAll(/set-cookie:/gi)].length, 2)
  const completedSocket = new WebSocket(url.replace('http:', 'ws:') + 'socket?lang=fr')
  const message = once(completedSocket, 'message')
  const closed = once(completedSocket, 'close')
  try {
    assert.equal((await bounded(message, 'WS final message timed out'))[0].data, 'fr')
    assert.equal((await bounded(closed, 'WS completion timed out'))[0].code, 1000)
  } finally { completedSocket.close() }

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
  rmSync(join(app, 'stream-cancelled'))
  const target = new URL(url)
  const slow = createConnection({ host: target.hostname, port: Number(target.port) })
  try {
    slow.on('error', () => {})
    slow.pause()
    await new Promise((resolve, reject) => { slow.once('connect', resolve); slow.once('error', reject) })
    slow.write(`POST /stream?mode=cancel HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`)
    await waitForFile(app, 'stream-cancelled')
  } finally { slow.destroy() }
  const slowSse = createConnection({ host: target.hostname, port: Number(target.port) })
  try {
    slowSse.on('error', () => {})
    slowSse.pause()
    await new Promise((resolve, reject) => { slowSse.once('connect', resolve); slowSse.once('error', reject) })
    slowSse.write(`GET /events?mode=flood HTTP/1.1\r\nHost: ${target.host}\r\nAccept: text/event-stream\r\n\r\n`)
    await waitForFile(app, 'sse-cancelled')
  } finally { slowSse.destroy() }
  console.log('PASS: guarded SSE/WS metadata; native POST streaming, UTF-8 framing, errors, disconnect, idle and stalled-reader cleanup')
}
