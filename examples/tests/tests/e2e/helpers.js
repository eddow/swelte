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
