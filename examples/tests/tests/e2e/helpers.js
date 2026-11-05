// Shared e2e helpers: free ports, wait-for-port, child spawn + kill.
// Used by dev/preview/binary suites so lifecycle handling stays identical.
import { spawn } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'

/** Plain node:http request with pooling disabled (agent:false): the socket is
 * destroyed when the response ends, so no pooled keep-alive handle can keep
 * the test runner's loop alive after the servers are killed. Returns
 * { status, headers, body }. */
export function request(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { agent: false, method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: {
            get: (k) => {
              const v = res.headers[String(k).toLowerCase()]
              return Array.isArray(v) ? v.join(', ') : (v ?? null)
            },
            raw: res.headers,
          },
          text: async () => Buffer.concat(chunks).toString('utf8'),
          arrayBuffer: async () =>
            Buffer.concat(chunks).buffer.slice(
              Buffer.concat(chunks).byteOffset,
              Buffer.concat(chunks).byteOffset + Buffer.concat(chunks).byteLength
            ),
          _buf: Buffer.concat(chunks),
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('request timeout: ' + method + ' ' + url)))
    req.end()
  })
}

export function get(url, headers = {}) {
  return request(url, { headers })
}

export function head(url, headers = {}) {
  return request(url, { method: 'HEAD', headers })
}

/** Raw-socket WebSocket client (future.md #3, zero-dep — mirrors headRaw).
 * Performs the RFC 6455 upgrade handshake; resolves `{ sock, send(text),
 * nextMessage(ms?), close() }`. send() masks one text frame (client→server
 * MUST mask); nextMessage() resolves the next text payload (auto-skips
 * `__ping__` heartbeats, answers pings, surfaces server close as error).
 * Caller owns teardown via close(). */
export function wsConnect(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    import('node:net').then(({ connect }) => {
      import('node:crypto').then(({ randomBytes, createHash }) => {
        const u = new URL(url)
        const port = Number(u.port) || 80
        const key = randomBytes(16).toString('base64')
        const wantAccept = createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64')
        const path = (u.pathname || '/') + (u.search || '')
        const lines = [
          `GET ${path} HTTP/1.1`,
          `Host: ${u.hostname}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
        ]
        for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`)
        lines.push('', '')
        const sock = connect(port, u.hostname || '127.0.0.1', () => {
          sock.write(lines.join('\r\n'))
        })
        let buf = Buffer.alloc(0)
        let settled = false
        const fail = (e) => {
          if (settled) return
          settled = true
          try { sock.destroy() } catch { /* ignore */ }
          reject(e)
        }
        const st = { buf: Buffer.alloc(0), waiters: [], closed: false }
        const pump = () => {
          for (;;) {
            if (st.buf.length < 2) return
            const fin = (st.buf[0] & 0x80) !== 0
            const op = st.buf[0] & 0x0f
            let len = st.buf[1] & 0x7f
            let off = 2
            if (len === 126) {
              if (st.buf.length < 4) return
              len = st.buf.readUInt16BE(2)
              off = 4
            } else if (len === 127) {
              fail(new Error('wsConnect: 64-bit server frame unsupported'))
              return
            }
            if (st.buf.length < off + len) return
            const payload = st.buf.subarray(off, off + len)
            st.buf = st.buf.subarray(off + len)
            if (op === 0x8) {
              st.closed = true
              for (const w of st.waiters.splice(0)) w.reject(new Error('ws closed by server'))
              try { sock.destroy() } catch { /* ignore */ }
              return
            }
            if (op === 0x9) {
              const pong = Buffer.alloc(2 + payload.length)
              pong[0] = 0x8a
              pong[1] = payload.length
              payload.copy(pong, 2)
              try { sock.write(pong) } catch { /* ignore */ }
              continue
            }
            if (op === 0xa) continue
            if (op !== 0x1 || !fin) {
              fail(new Error(`wsConnect: unsupported frame op=${op} fin=${fin}`))
              return
            }
            const text = payload.toString('utf8')
            if (text === '__ping__') continue
            const w = st.waiters.shift()
            if (w) w.resolve(text)
          }
        }
        sock.on('data', (c) => {
          if (!settled) {
            buf = Buffer.concat([buf, c])
            const s = buf.toString('latin1')
            const end = s.indexOf('\r\n\r\n')
            if (end < 0) {
              if (buf.length > 8192) fail(new Error('wsConnect: head too large'))
              return
            }
            const head = s.slice(0, end)
            const status = Number((head.split('\r\n')[0] ?? '').split(' ')[1] ?? 0)
            if (status !== 101) {
              fail(new Error(`wsConnect: want 101, got ${status}: ${head.slice(0, 200)}`))
              return
            }
            const m = /sec-websocket-accept:\s*(\S+)/i.exec(head)
            if (!m || m[1].trim() !== wantAccept) {
              fail(new Error('wsConnect: bad Sec-WebSocket-Accept'))
              return
            }
            settled = true
            st.buf = buf.subarray(end + 4)
            resolve(wsApi(sock, st, pump, randomBytes))
            pump()
            return
          }
          st.buf = Buffer.concat([st.buf, c])
          pump()
        })
        sock.on('error', (e) => fail(e))
        sock.on('close', () => {
          if (!settled) fail(new Error('wsConnect: closed before 101'))
          else {
            st.closed = true
            for (const w of st.waiters.splice(0)) w.reject(new Error('ws closed'))
          }
        })
        sock.setTimeout(30000, () => fail(new Error('wsConnect: timeout')))
      }, reject)
    }, reject)
  })
}


/** Live socket API returned by wsConnect (split for edit-size limits). */
function wsApi(sock, st, pump, randomBytes) {
  return {
    sock,
    send(text) {
      const payload = Buffer.from(text, 'utf8')
      if (payload.length > 65535) throw new Error('wsConnect.send: frame too large (64KB cap)')
      const mask = randomBytes(4)
      const hdr = payload.length < 126
        ? Buffer.from([0x81, 0x80 | payload.length])
        : Buffer.from([0x81, 0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff])
      const masked = Buffer.alloc(payload.length)
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4]
      sock.write(Buffer.concat([hdr, mask, masked]))
    },
    nextMessage(ms = 15000) {
      return new Promise((res2, rej2) => {
        if (st.closed) { rej2(new Error('ws closed by server')); return }
        const timer = setTimeout(() => {
          const i = st.waiters.findIndex((w) => w.resolve === res2)
          if (i >= 0) st.waiters.splice(i, 1)
          rej2(new Error('wsConnect.nextMessage: timeout'))
        }, ms)
        st.waiters.push({
          resolve: (v) => { clearTimeout(timer); res2(v) },
          reject: (e) => { clearTimeout(timer); rej2(e) },
        })
        pump()
      })
    },
    close() {
      return new Promise((res2) => {
        try { sock.write(Buffer.from([0x88, 0x00])) } catch { /* ignore */ }
        sock.once('close', () => res2())
        setTimeout(() => { try { sock.destroy() } catch { /* ignore */ }; res2() }, 2000)
      })
    },
  }
}

/** Raw-socket HEAD: veb answers HEAD with headers-then-close framing that
 * node:http's strict parser rejects (HPE_CLOSED_CONNECTION), even though
 * the status line + headers are on the wire. This reads just the head
 * block over net.Socket so header asserts (X-Swelte-Version) hold. */
export function headRaw(url, headers = {}) {
  return new Promise((resolve, reject) => {
    import('node:net').then(({ connect }) => {
      const u = new URL(url)
      const port = Number(u.port) || 80
      const sock = connect(port, u.hostname || '127.0.0.1', () => {
        const lines = [`HEAD ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.hostname}`]
        for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`)
        lines.push('Connection: close', '', '')
        sock.write(lines.join('\r\n'))
      })
      let buf = ''
      const done = (err) => {
        try { sock.destroy() } catch { /* ignore */ }
        if (err) { reject(err); return }
        const headBlock = buf.split('\r\n\r\n')[0] ?? ''
        const headLines = headBlock.split('\r\n')
        const status = Number((headLines[0] ?? '').split(' ')[1] ?? 0)
        const out = {}
        for (const ln of headLines.slice(1)) {
          const i = ln.indexOf(':')
          if (i > 0) out[ln.slice(0, i).trim().toLowerCase()] = ln.slice(i + 1).trim()
        }
        resolve({ status, headers: { get: (k) => out[String(k).toLowerCase()] ?? null, raw: out } })
      }
      sock.on('data', (c) => { buf += c.toString('latin1') })
      sock.on('end', () => done())
      sock.on('close', () => done(buf ? undefined : new Error('headRaw: empty response from ' + url)))
      sock.on('error', (e) => done(e))
      sock.setTimeout(15000, () => done(new Error('headRaw timeout: ' + url)))
    }, reject)
  })
}

export async function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      const p = typeof a === 'object' && a ? a.port : 0
      s.close(() => res(p))
    })
  })
}

export async function waitHttp(port, { ms = 60000, path = '/' } = {}) {
  const t0 = Date.now()
  const url = `http://127.0.0.1:${port}${path}`
  for (;;) {
    try {
      const res = await get(url)
      await res.text().catch(() => {})
      return
    } catch {
      if (Date.now() - t0 > ms) throw new Error(`nothing listening on :${port}${path} within ${ms}ms`)
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

export function spawnChild(cmd, args, { cwd, env = {}, silent = false } = {}) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    // `swelte dev` grandchildren (V backend + Vite) inherit our fds: with
    // piped stdio the pipes stay open after the kill and the runner's loop
    // never empties. dev readiness is HTTP-polled, its logs unneeded, so
    // dev spawns fully silent; binary/preview keep pipes (single process).
    stdio: silent ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe'],
    // Detached process group: group kill in killChild() takes the whole
    // tree down (no orphaned V/Vite holding ports). No-op on Windows.
    detached: process.platform !== 'win32',
  })
  if (!silent) {
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', () => {})
  }
  // The ChildProcess handle itself is ref'd until 'exit' is reaped; the
  // explicit killChild() in after() owns teardown, so unref here and never
  // let a slow group shutdown hold the runner's loop open.
  child.unref?.()
  return child
}

export async function killChild(child) {
  if (!child) return
  const gid = -child.pid
  const groupKill = (sig) => {
    try {
      // Negative pid = whole process group (POSIX). Falls back to the
      // direct child when groups are unsupported.
      process.kill(gid, sig)
    } catch {
      try {
        child.kill(sig)
      } catch { /* ignore */ }
    }
  }
  groupKill('SIGTERM')
  await new Promise((r) => setTimeout(r, 1500))
  groupKill('SIGKILL')
  await new Promise((r) => setTimeout(r, 800))
}
