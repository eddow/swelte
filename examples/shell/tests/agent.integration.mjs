import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

const tool = (name, args) => `<tool backend.shell_tools.tool_${name} ${JSON.stringify(args)}>`
test('compiled console: tools, approval, continuation, replay, denial and preemption', { timeout: 60000 }, async () => {
 const dir = await mkdtemp(join(tmpdir(), 'shell-agent-'))
 await writeFile(join(dir, 'README.txt'), 'fixture file')
 const requests = []
 let reply = 'Hello from the console.'
 const provider = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  requests.push(JSON.parse(body))
  const text = typeof reply === 'function' ? reply(requests.at(-1)) : reply
  res.setHeader('content-type', 'application/json')
  // Native-shaped fixtures return wire-accurate bodies verbatim; text
  // fixtures return the legacy content wrapper.
  if (typeof text === 'string') res.end(JSON.stringify(req.url === '/responses' ? { output: [{ content: [{ text }] }] } : req.url === '/v1/messages' ? { content: [{ text }] } : { choices: [{ message: { content: text } }] }, null, 2))
  else res.end(JSON.stringify(text))
 })
 provider.listen(0, '127.0.0.1'); await once(provider, 'listening')
 const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening')
 let port = reserve.address().port; await new Promise(r => reserve.close(r))
 const baseEnv = { ...process.env, SWELTE_RATE_LIMIT: '1000', SWELTE_DB_PATH: join(dir, 'test.db'), OPENROUTER_API_KEY: 'fixture-only', OPENAI_API_KEY: 'fixture-only', ANTHROPIC_API_KEY: 'fixture-only', SHELL_TEST_LEASE: '1', SHELL_AI_BASE_URL: `http://127.0.0.1:${provider.address().port}` }
 let proc = spawn(resolve('dist/server'), [], { cwd: dir, env: { ...baseEnv, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
 let logs = ''; proc.stdout.on('data', b => logs += b); proc.stderr.on('data', b => logs += b)
 let base = `http://127.0.0.1:${port}`
 const rpc = async (fn, args) => {
  const res = await fetch(base + '/', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ fn, args }) })
  return { status: res.status, body: await res.json() }
 }
 const run = async (prompt, drive = false, continuation = '', adapter = 'openrouter', model = 'fixture', allowRejected = false) => {
  const res = await fetch(base + '/?/ai_stream', { method: 'POST', headers: { accept: 'text/event-stream' }, body: new URLSearchParams({ adapter, model, prompt, drive: drive ? '1' : '0', continuation }) })
  if(allowRejected && res.status===400){await res.text();return []}
  assert.equal(res.status, 200)
  return (await res.text()).split('\n\n').filter(b => b.includes('data: ')).map(b => JSON.parse(b.split('data: ')[1]))
 }
 const parked = events => {
  assert.equal(events.at(-1).payload.reason, 'waiting_approval', JSON.stringify(events))
  const p = events.find(e => e.envelope.kind === 'approval.request').payload
  return { op_id: p.op_id, holder: p.holder, tool: p.tool, args_json: p.args }
 }
 const traces = events => events.filter(e => e.envelope.kind === 'shell.trace').map(e => e.payload)
 const traceEnd = events => traces(events).filter(t => t.event === 'turn.end').at(-1) ?? {}
 try {
  for (let i = 0; i < 100; i++) {
   try { if ((await fetch(base + '/health')).ok) break } catch {}
   if (proc.exitCode !== null) throw new Error(logs)
   await new Promise(r => setTimeout(r, 50))
  }
  let events = await run('What tools can you use?')
  assert.equal(events.at(-1).payload.reason, 'completed', JSON.stringify(events))
  assert.match(requests.at(-1).messages[0].content, /shell_read_output/)
  assert.match(requests.at(-1).messages[0].content, /Read-only console queries/)
  reply = req => req.messages[1].content.includes('Tool result (untrusted data):') ? 'Observed “terminal” output.' : tool('shell_read_output', { since_seq: 0, limit: 5 })
  events = await run('Inspect terminal')
  assert.ok(events.some(e => e.payload.text === 'Observed “terminal” output.'))
  // Regression: the exact abbreviated call with surrounding prose from the UI report.
  for (const adapter of ['openrouter', 'openai', 'anthropic']) {
   reply = req => {
    const prompt = (req.messages ?? req.input)[0].role === 'system' ? (req.messages ?? req.input)[1].content : req.messages[0].content
    if (prompt.includes('Tool result (untrusted data):')) return 'The terminal was inspected.'
    return `I'll check our console location and recent activity.\n\n<backend.shell_tools.tool_shell_read_output {"since_seq": 0, "limit": 5}>`
   }
   const observed = await run('Read the console', false, '', adapter)
   assert.equal(observed.at(-1).payload.reason, 'completed')
   assert.ok(observed.some(e => e.payload.text === 'The terminal was inspected.'))
   // P0: `shell.trace` diagnostics share `tool.progress` framing only in
   // the SSE transport sense — they carry no `payload.tool` and must never
   // count as tool calls.
   const calls = observed.filter(e => e.envelope.kind === 'tool.progress' && e.payload.tool)
   assert.equal(calls.length, 1)
   assert.equal(calls[0].payload.label, 'Read recent terminal output')
   assert.ok(observed.filter(e => e.envelope.kind === 'tool.progress' && !e.payload.tool).every(e => !e.payload.callId))
   assert.ok(observed.filter(e => e.payload.text).every(e => !e.payload.text.includes('<backend.')))
  }
  // Bare exec syntax normalizes to the read path. It must read
  // the real cwd and feed the result back, without approval or leaked syntax.
  for (const adapter of ['openrouter', 'openai', 'anthropic']) {
   reply = req => {
    const messages = req.messages ?? req.input
    const prompt = messages[messages.length - 1].content
    if (prompt.includes('Tool result (untrusted data):')) {
     assert.ok(prompt.includes(dir), 'model must receive the actual sandbox cwd')
     return `Our console is in ${dir}.`
    }
    return `I'll check the console location for you.\n\nbackend.shell_tools.tool_shell_exec {"cmd": "pwd"}`
   }
   const inspected = await run('Where is our console?', false, '', adapter)
   assert.equal(inspected.at(-1).payload.reason, 'completed')
   assert.ok(inspected.some(e => e.payload.text === `Our console is in ${dir}.`))
   assert.ok(!inspected.some(e => e.envelope.kind === 'approval.request'))
   assert.ok(inspected.filter(e => e.payload.text).every(e => !e.payload.text.includes('backend.shell_tools.')))
  }
  // Read-only normalization must never turn cd or another action into a query.
  reply = 'backend.shell_tools.tool_shell_exec {"cmd":"cd .."}'
  const blocked = await run('Try changing cwd without terminal access')
  assert.equal(blocked.at(-1).payload.reason, 'failed')
  assert.ok(!blocked.some(e => e.envelope.kind === 'approval.request'))
  // Live model also abbreviates names and may emit two calls at once.
  // Execute one, report only that call, then let the model request the next.
  reply = req => {
   const prompt = req.messages[1].content
   if (prompt.includes('Tool result (untrusted data):')) {
    if (prompt.includes('README.txt')) return 'Read cwd and files successfully.'
    assert.ok(!prompt.includes('"cmd":"ls"'), 'unexecuted calls must not enter executed history')
    return '<tool_shell_query {"cmd":"ls"}>'
   }
   return '<tool_shell_query {"cmd":"pwd"}>\n<tool_shell_query {"cmd":"ls"}>'
  }
  assert.ok((await run('Inspect cwd and files')).some(e => e.payload.text === 'Read cwd and files successfully.'))
  // A partial wrapper must trigger a retry, never render tool syntax.
  reply = req => (req.messages[1].content.includes('could not be parsed') ? 'Recovered cleanly.' : '<backend.shell_tools.tool_shell_read_output {')
  assert.ok((await run('Recover malformed syntax')).some(e => e.payload.text === 'Recovered cleanly.'))
  // P0 regression: the reported `what is your pwd ?` loop. Fixture requests
  // the same pwd read even after receiving its result (up to six decisions).
  // The trace must distinguish model decisions, backend starts and result
  // deliveries — six rendered rows must never be mistaken for six
  // executions. P1 exit: one execution, <=2 model requests, grounded
  // answer, one terminal turn, no stale rows. Whitespace variants of the
  // same read share one canonical identity.
  let loopDecisions = 0
  reply = req => {
    const prompt = req.messages.at(-1).content
    if (prompt.includes('Tool result (untrusted data):')) {
      assert.ok(prompt.includes(dir), 'model must receive the actual sandbox cwd')
      loopDecisions++
      if (loopDecisions >= 5) return `Our console is in ${dir}.`
      return loopDecisions % 2 ? tool('shell_query', { cmd: 'pwd' }) : tool('shell_query', { cmd: '  pwd  ' })
    }
    return tool('shell_query', { cmd: 'pwd' })
  }
  const looped = await run('what is your pwd ?')
  const loopEnd = traceEnd(looped)
  const loopTraces = traces(looped)
  const decided = loopTraces.filter(t => t.event === 'tool.decided')
  const started = loopTraces.filter(t => t.event === 'tool.start')
  const results = loopTraces.filter(t => t.event === 'tool.result')
  const reused = loopTraces.filter(t => t.event === 'tool.reused')
  assert.ok(looped.some(e => e.payload.text === `Our console is in ${dir}.`) ||
    looped.some(e => typeof e.payload.text === 'string' && e.payload.text.includes(dir) && e.payload.text.includes('Console result')),
    'loop must end with the grounded answer')
  assert.equal(looped.at(-1).payload.reason, 'completed', JSON.stringify(looped.at(-1)))
  // P1: exactly one backend execution; repeats reuse the cached result.
  assert.equal(started.length, 1, `one backend pwd execution (got ${started.length})`)
  assert.equal(results.length, 1, 'one result delivery')
  assert.equal(looped.filter(e => e.envelope.kind === 'tool.progress' && e.payload.tool).length, 1,
    'S1: one readable tool row')
  assert.equal(looped.filter(e => e.envelope.kind === 'tool.progress' && e.payload.tool)[0]?.payload.label,
    'Read working directory', 'S1/S4: the row names the actual inspection')
  assert.ok(decided.every(t => t.tool === 'backend.shell_tools.tool_shell_query'), 'only the pwd read may run')
  assert.ok(new Set(decided.map(t => t.args_hash)).size === 1, 'canonical pwd identity (whitespace variants dedup)')
  assert.ok(reused.length >= 1, 'repeats must reuse, not re-execute')
  assert.ok(loopEnd.repeats >= 1, `trace must flag the repeat sequence (got ${loopEnd.repeats})`)
  assert.ok(loopEnd.model_reqs <= 2, `S1: at most two model requests (got ${loopEnd.model_reqs})`)
  assert.ok(loopEnd.elapsed_ms < 1000, `deterministic fixture: answer within one second (got ${loopEnd.elapsed_ms}ms)`)
  // Determinism note: fixture timing is not the live p95 target (10 s /
  // 15 s deadline). The live gate stays in the P5 acceptance pack.
  assert.ok(!looped.filter(e => e.payload.text).some(e => e.payload.text.includes('backend.shell_tools.')),
    'no tool syntax may leak into the ordinary answer')
  // P1/S2: pwd + ls sequential, each executed once, then answered.
  let s2Phase = 0
  reply = req => {
    const prompt = req.messages.at(-1).content
    if (s2Phase === 0 && !prompt.includes('Tool result')) return tool('shell_query', { cmd: 'pwd' })
    if (s2Phase === 0) { s2Phase = 1; return tool('shell_query', { cmd: 'ls' }) }
    s2Phase = 2
    assert.ok(prompt.includes(dir), 'model must receive the actual sandbox cwd')
    assert.ok(prompt.includes('README.txt'), 'model must receive the actual listing')
    return `Our console is in ${dir} with README.txt.`
  }
  const two = await run('Where are we and what files are here?')
  const twoEnd = traceEnd(two)
  const twoStarted = traces(two).filter(t => t.event === 'tool.start')
  const twoLabels = two.filter(e => e.envelope.kind === 'tool.progress' && e.payload.tool).map(e => e.payload.label)
  assert.equal(two.at(-1).payload.reason, 'completed', JSON.stringify(two.at(-1)))
  assert.ok(two.some(e => e.payload.text === `Our console is in ${dir} with README.txt.`), 'S2 answers from both actual results')
  assert.equal(twoStarted.length, 2, `one pwd + one ls execution (got ${twoStarted.length})`)
  assert.deepEqual(twoLabels, ['Read working directory', 'List project files'], 'S4: rows name the actual inspections')
  assert.ok(twoEnd.model_reqs <= 3, `S2: <=3 model requests (got ${twoEnd.model_reqs})`)
  assert.ok(twoEnd.elapsed_ms < 25000, `S2 deadline (got ${twoEnd.elapsed_ms}ms)`)
  // Non-consecutive repeats hit the per-turn cache: pwd→ls→pwd executes
  // twice total; the third decision (repeat pwd) answers immediately from
  // cache with an explicitly attributed result — no third execution.
  {
    const seq5 = ['pwd', 'ls', 'pwd']
    let alt = 0
    reply = req => tool('shell_query', { cmd: seq5[alt++] ?? 'pwd' })
    const altEv = await run('Where are we and what files recur?')
    const altStarted = traces(altEv).filter(t => t.event === 'tool.start')
    const altReused = traces(altEv).filter(t => t.event === 'tool.reused')
    assert.equal(altStarted.length, 2, `pwd+ls execute once each (got ${altStarted.length})`)
    assert.equal(altReused.length, 1, 'the repeated pwd reuses from cache')
    assert.ok(altEv.some(e => typeof e.payload.text === 'string' && e.payload.text.includes('Console result') && e.payload.text.includes(dir)),
      'repeat answers immediately with the attributed cached result')
    assert.equal(altEv.at(-1).payload.reason, 'completed')
  }
  // Failure typing: a failed read surfaces as a typed error — traced
  // failed, row settles failed, history gets the error — and never enters
  // the reuse cache (a later identical read re-executes).
  {
    let probe = 0
    reply = req => {
      if (probe++ === 0) return tool('shell_query', { cmd: 'cd /' })
      return tool('shell_query', { cmd: 'pwd' })
    }
    const failEv = await run('Probe a failing read')
    const failRes = traces(failEv).filter(t => t.event === 'tool.result')
    assert.ok(failRes.some(t => t.failed === true), 'failed dispatch traced as failed')
    assert.ok(failRes.some(t => typeof t.reason === 'string' && t.reason.startsWith('error:')), 'error carried in reason, never shaped as a result')
  }
  reply = tool('shell_exec', { cmd: 'echo approved "value"' })
  const p = parked(await run('Echo a value', true))
  assert.match(requests.at(-1).messages[0].content, /shell_browse/)
  assert.equal((await rpc('shell_tool_resume', { ...p, args_json: '{}' })).status, 400)
  const approved = await rpc('shell_tool_resume', p)
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  assert.equal(approved.body.output, 'approved "value"')
  assert.deepEqual((await rpc('shell_tool_resume', p)).body, approved.body)
  reply = req => { assert.match(req.messages[1].content, /Approved tool:/); return 'The approved command succeeded.' }
  const beforeContinuation=requests.length
  const competing=await Promise.all([run('continue', true, approved.body.continuation, 'anthropic', 'changed-model', true), run('continue', true, approved.body.continuation, 'openrouter', 'fixture', true)])
  assert.equal(competing.filter(es=>es.some(e=>e.payload.text==='The approved command succeeded.')).length,1,'continuation consumed atomically')
  assert.equal(requests.length-beforeContinuation,1,'one model loop for concurrent continuation')
  assert.equal(requests.at(-1).model,'fixture','saved provider configuration survives client changes')
  for (const adapter of ['openai', 'anthropic']) {
   reply = 'Adapter reply with "quotes" and Unicode: λ'
   assert.ok((await run('Adapter check', false, '', adapter)).some(e => e.payload.text === reply))
  }
  reply = tool('shell_browse', { url: 'http://invalid.example' })
  const browse = parked(await run('Browse a URL', true))
  const invalid = await rpc('shell_tool_resume', browse)
  assert.equal(invalid.status, 400)
  assert.match(invalid.body.error, /HTTPS/)
  await rpc('shell_tool_deny', browse)
  reply = tool('shell_exec', { cmd: 'echo denied' })
  const denied = parked(await run('Deny this', true))
  assert.equal((await rpc('shell_tool_deny', denied)).status, 200)
  assert.equal((await rpc('shell_tool_resume', denied)).status, 400)
  const stale = parked(await run('Preempt this', true))
  await rpc('exec', { cmd: 'pwd', caller: 'human', op_id: 'human' })
  assert.equal((await rpc('shell_tool_resume', stale)).status, 400)
  // P4/S5 human-control matrix: concurrent + duplicate decisions, changed
  // arguments/holder rejection, expired-lease refusal — all against the
  // backend, all fail-closed except the single approved dispatch.
  reply = tool('shell_exec', { cmd: 'echo concurrent' })
  const racing = parked(await run('Race this', true))
  const [race1, race2] = await Promise.all([rpc('shell_tool_resume', racing), rpc('shell_tool_resume', racing)])
  assert.equal(race1.status, 200, JSON.stringify(race1.body))
  assert.deepEqual(race2.body, race1.body, 'duplicate resume replays the receipt, no second execution')
  assert.equal(race1.body.output, 'concurrent')
  const tampered = { ...racing, args_json: racing.args_json.replace('concurrent', 'tampered') }
  assert.equal((await rpc('shell_tool_resume', tampered)).status, 400, 'changed arguments rejected')
  const foreign = { ...racing, holder: 'run-evil/turn-9' }
  assert.equal((await rpc('shell_tool_resume', foreign)).status, 400, 'changed holder rejected')
  // Lost acknowledgement: replaying the approved receipt returns it without
  // re-executing (already covered pre-restart above via race2 == race1).
  reply = tool('shell_exec', { cmd: 'echo stale-lease' })
  const expiring = parked(await run('Expire this', true))
  await rpc('exec', { cmd: 'pwd', caller: 'human', op_id: 'human' })
  const expiredResume = await rpc('shell_tool_resume', expiring)
  assert.equal(expiredResume.status, 400)
  assert.match(expiredResume.body.error, /superseded/)
  // P4 true TTL-lapse expiry: backdate the lease (test-only RPC) so the
  // expiry is genuine wall-clock lapse, not a human flip.
  {
    reply = tool('shell_exec', { cmd: 'echo ttl-lapse' })
    const lapsed = parked(await run('Lapse this lease', true))
    const back = await rpc('shell_test_backdate_lease', { holder: lapsed.holder, ago_s: 3600 })
    assert.equal(back.status, 200, JSON.stringify(back.body))
    const lapsedResume = await rpc('shell_tool_resume', lapsed)
    assert.equal(lapsedResume.status, 400, 'lapsed lease must refuse resume')
    assert.match(lapsedResume.body.error, /superseded|expired/)
    const lapsedDeny = await rpc('shell_tool_deny', lapsed)
    assert.equal(lapsedDeny.status, 200, 'lapsed deny stays idempotent')
    assert.match(lapsedDeny.body.output, /denied/)
  }
  // P4 real restart rotation: approve + receipt on boot-1, then kill and
  // respawn the backend on the same DB file (KV survives, `__global`
  // boot id resets). Stale-boot resume/deny/continue fail closed; the
  // stored receipt still replays without re-executing.
  {
    reply = tool('shell_exec', { cmd: 'echo restart-receipt' })
    const doomed = parked(await run('Approve before restart', true))
    const revBefore = await rpc('shell_revision', { dummy: '' })
    assert.equal(revBefore.status, 200)
    const bootBefore = revBefore.body.boot_id
    const ok1 = await rpc('shell_tool_resume', doomed)
    assert.equal(ok1.status, 200, JSON.stringify(ok1.body))
    assert.equal(ok1.body.output, 'restart-receipt')
    reply = tool('shell_exec', { cmd: 'echo unapproved-before-restart' })
    const unapproved = parked(await run('Park before restart', true))
    proc.kill('SIGTERM')
    try { await Promise.race([once(proc, 'exit'), new Promise(r => setTimeout(r, 3000))]) } catch {}
    try { if (proc.exitCode === null) proc.kill('SIGKILL') } catch {}
    const reserve2 = createServer(); reserve2.listen(0, '127.0.0.1'); await once(reserve2, 'listening')
    port = reserve2.address().port; await new Promise(r => reserve2.close(r))
    base = `http://127.0.0.1:${port}`
    const proc2 = spawn(resolve('dist/server'), [], { cwd: dir, env: { ...baseEnv, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
    let logs2 = ''
    proc2.stdout.on('data', b => logs2 += b); proc2.stderr.on('data', b => logs2 += b)
    try {
      for (let i = 0; i < 100; i++) {
        try { if ((await fetch(base + '/health')).ok) break } catch {}
        if (proc2.exitCode !== null) throw new Error(logs2)
        await new Promise(r => setTimeout(r, 100))
      }
      const revAfter = await rpc('shell_revision', { dummy: '' })
      assert.equal(revAfter.status, 200, JSON.stringify(revAfter.body))
      assert.notEqual(revAfter.body.boot_id, bootBefore, 'respawn must rotate the boot id')
      const replay = await rpc('shell_tool_resume', doomed)
      assert.equal(replay.status, 200, 'receipt replays across a real restart')
      assert.deepEqual(replay.body, ok1.body, 'lost-ack replay returns the stored receipt, no re-execution')
      const staleResume = await rpc('shell_tool_resume', unapproved)
      assert.equal(staleResume.status, 400, 'unexecuted pre-restart operation must not run')
      assert.match(staleResume.body.error, /superseded by restart/)
      const originalContinuation = await fetch(base + '/?/ai_stream', {method:'POST',body:new URLSearchParams({adapter:'openrouter', model:'fixture', prompt:'continue', continuation:ok1.body.continuation})})
      assert.equal(originalContinuation.status,400)
      assert.match(await originalContinuation.text(), /superseded by restart/)
      const staleDeny = await rpc('shell_tool_deny', doomed)
      assert.equal(staleDeny.status, 400, 'stale-boot deny of an approved op fails closed (receipt stands)')
      assert.match(staleDeny.body.error, /superseded by restart/)
      reply = tool('shell_exec', { cmd: 'echo stale-after-restart' })
      const fresh = parked(await run('Park after restart', true))
      const contBefore = await rpc('shell_tool_resume', fresh)
      assert.equal(contBefore.status, 200)
      const staleCont = await fetch(base + '/?/ai_stream', { method: 'POST', headers: { accept: 'text/event-stream' }, body: new URLSearchParams({ adapter: 'openrouter', model: 'fixture', prompt: 'x', drive: '0', continuation: String(contBefore.body.continuation) + '-tampered' }) })
      assert.ok(!(await staleCont.text()).includes('"reason":"completed"'), 'unknown continuation must not complete')
      proc = proc2; logs = logs2
    } finally {
      if (proc !== proc2) { proc2.kill('SIGTERM'); try { await Promise.race([once(proc2, 'exit'), new Promise(r => setTimeout(r, 2000))]) } catch {} }
    }
  }

  // S7: revision surface answers before any acceptance run.
  {
    const rev = await rpc('shell_revision', { dummy: '' })
    assert.equal(rev.status, 200, JSON.stringify(rev.body))
    assert.ok(typeof rev.body.backend_revision === 'string' && rev.body.backend_revision.length > 0, 'backend revision present')
    assert.ok(typeof rev.body.boot_id === 'string' && rev.body.boot_id.length > 0, 'boot id present')
    assert.equal(rev.body.room_version, 'v2')
  }
  // S3: `cd` invalidates the revision-gated read cache. Park a drive, cd to a
  // subdirectory via resume, then a fresh `pwd` must return the NEW cwd —
  // not the cached parent.
  reply = tool('shell_exec', { cmd: 'echo subdir-probe' })
  const pre = parked(await run('Probe subdir', true))
  await rpc('shell_tool_deny', pre)
  // Drive a real cd through approval, then pwd must observe the new cwd.
  const fs = await import('node:fs')
  fs.mkdirSync(join(dir, 'sub'), { recursive: true })
  reply = tool('shell_exec', { cmd: 'cd sub' })
  const cdPark = parked(await run('Change dir', true))
  const cdRes = await rpc('shell_tool_resume', cdPark)
  assert.equal(cdRes.status, 200, JSON.stringify(cdRes.body))
  assert.ok(cdRes.body.output.endsWith('/sub'), `cd lands in sub (got ${cdRes.body.output})`)
  reply = () => tool('shell_query', { cmd: 'pwd' })
  {
    const pwdEv = await run('Where now?')
    assert.equal(pwdEv.at(-1).payload.reason, 'completed')
    assert.ok(pwdEv.some(e => typeof e.payload.text === 'string' && e.payload.text.endsWith('/sub')),
      'S3: pwd after cd returns the new directory, not the cached parent')
  }
  // S3 isolation: the subdir probe moved cwd; reset to the sandbox root so
  // the symlink-confinement fixture below resolves from a known directory.
  reply = tool('shell_exec', { cmd: 'cd /' })
  const cdBack = parked(await run('Back to root', true))
  assert.equal((await rpc('shell_tool_resume', cdBack)).status, 200)
  const outside = join(tmpdir(), `outside-${port}`)
  await writeFile(outside, 'outside secret'); await symlink(outside, join(dir, 'escape'))
  assert.match((await rpc('exec', { cmd: 'cat escape', caller: 'human', op_id: 'escape' })).body.output, /outside sandbox|cannot read/)
  await rm(outside)
  const get = await fetch(base + '/api/tools?only=shell_exec&approve=1', { headers: { accept: 'application/json' } })
  assert.match(await get.text(), /console POST approval/)
  // P2 adapter conformance: identical semantic scenarios by changing only
  // provider configuration. Native wires carry typed calls + provider call
  // ids + typed result delivery; text-only models get a capability error.
  const q = 'backend.shell_tools.tool_shell_query'
  const qAlias = 'shell_query'
  // Wire-accurate native shapes with provider-safe ALIASES (P1: dotted V
  // names are invalid under OpenAI/Anthropic naming rules, so the wire
  // carries `shell_query` etc. and the backend maps back to `q` before
  // allowlist/dispatch). OpenRouter chat-completions (tool_calls[] +
  // arguments as JSON STRING), OpenAI Responses (output[] function_call +
  // arguments string), Anthropic Messages (content[] tool_use + input
  // object). `done` arrives as the matching final-text shape per wire.
  const nativeShapes = {
    openrouter: { tool: () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-or-1', type: 'function', function: { name: qAlias, arguments: JSON.stringify({ cmd: 'pwd' }) } }] } }] }), done: { choices: [{ message: { content: `Our console is in ${dir}.` } }] } },
    openai: { tool: () => ({ output: [{ type: 'function_call', call_id: 'call-oai-1', name: qAlias, arguments: JSON.stringify({ cmd: 'pwd' }) }] }), done: { output: [{ type: 'message', content: [{ type: 'output_text', text: `Our console is in ${dir}.` }] }] } },
    anthropic: { tool: () => ({ content: [{ type: 'tool_use', id: 'toolu-an-1', name: qAlias, input: { cmd: 'pwd' } }] }), done: { content: [{ type: 'text', text: `Our console is in ${dir}.` }] } },
  }
  for (const adapter of ['openrouter', 'openai', 'anthropic']) {
    let phase = 0
    const shape = nativeShapes[adapter]
    let sawLinkedResult = false
    reply = req => {
      const body = JSON.stringify(req)
      // Linked result messages per wire (typed linkage, not prose):
      // completions role=tool, Responses function_call_output,
      // Anthropic tool_result. Text history mirror comes second.
      if (body.includes('function_call_output') || body.includes('"role":"tool"') || body.includes('tool_result')) sawLinkedResult = true
      if (body.includes('Tool result (untrusted data):') || sawLinkedResult) return shape.done
      if (phase++ > 0) return shape.done
      return shape.tool()
    }
    const conformed = await run('Where is our console?', false, '', adapter, 'fixture-tool')
    assert.equal(conformed.at(-1).payload.reason, 'completed', JSON.stringify(conformed.at(-1)))
    assert.ok(conformed.some(e => e.payload.text === `Our console is in ${dir}.`), adapter + ': native result must answer')
    const nativeEv = traces(conformed).find(t => t.event === 'tool.native')
    assert.ok(nativeEv, adapter + ': native call must be traced')
    assert.equal(nativeEv.tool, q)
    assert.ok(traces(conformed).some(t => t.event === 'tool.start' && t.tool === q), adapter + ': one backend start')
    assert.ok(traces(conformed).every(t => t.failed !== true || t.event === 'turn.end'), adapter + ': no failure typed on the fixture path')
    assert.ok(conformed.filter(e => e.payload.text).every(e => !e.payload.text.includes('backend.shell_tools.')),
      adapter + ': no protocol leak in ordinary answer')
    const gotTools = requests.at(-1)
    const sentBody = JSON.stringify(gotTools)
    assert.ok(sentBody.includes('"tools"'), adapter + ': request must declare tools')
    assert.ok(sentBody.includes(qAlias), adapter + ': request must name the query tool alias')
    // P1: no dotted internal name inside provider tool declarations or the
    // model-facing prose. (`approval.request` SSE payloads and trace events
    // carry the internal DISPATCH name server-side — those never reach a
    // provider. Scope the check to wire shapes: messages/input/tools.)
    for (const declaration of gotTools.tools ?? []) {
      const name = declaration.function?.name ?? declaration.name
      assert.match(name, /^[A-Za-z0-9_-]{1,64}$/, 'every declared provider name must be valid')
    }
    const wireNames = [...sentBody.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map(m => m[1]).filter(n => n.startsWith('shell_'))
    assert.ok(wireNames.length > 0, adapter + ': wire tool names present')
    assert.ok(wireNames.every(n => /^[A-Za-z0-9_-]{1,64}$/.test(n)), adapter + ': wire names provider-safe, got ' + JSON.stringify(wireNames))
    if (adapter === 'anthropic') assert.ok(sentBody.includes('input_schema'), 'anthropic declares input_schema')
    if (adapter === 'openrouter') assert.ok(sentBody.includes('tool_choice'), 'openrouter declares tool_choice')
    if (adapter === 'openai') assert.ok(/"type"\s*:\s*"function"/.test(sentBody) && !sentBody.includes('"function":{"name"'), 'responses uses flat function tools')
    if (phase > 1) assert.ok(sawLinkedResult, adapter + ': second request must carry the linked result message')
  }
  // P3 lifecycle: per-call settle at the dispatch boundary. pwd executes,
  // its row settles `done` on `tool.result` before the turn ends; the
  // repeated read reuses without a new row; two distinct reads keep
  // distinct call ids (no duplicate-key collapse); no terminal turn retains
  // a running row. SSE-client level (row state mirrored from the real event
  // stream); full DOM assertion needs a browser harness (no
  // Playwright/puppeteer in tree).
  {
    let calls = 0
    reply = req => {
      const prompt = req.messages.at(-1).content
      if (prompt.includes('Tool result (untrusted data')) {
        calls++
        if (calls === 1) return tool('shell_query', { cmd: 'ls' })
        return `In ${dir} with README.txt.`
      }
      return tool('shell_query', { cmd: 'pwd' })
    }
    const seq = await run('Where are we and what files are here?')
    const rows = seq.filter(e => e.envelope.kind === 'tool.progress' && e.payload.tool)
    assert.equal(rows.length, 2, 'two executions, two rows (S2)')
    assert.ok(new Set(rows.map(r => r.payload.callId)).size === 2, 'distinct call ids, no duplicate-key collapse')
    const seqTraces = traces(seq)
    const resEv = seqTraces.filter(t => t.event === 'tool.result')
    assert.equal(resEv.length, 2, 'each execution emits its completion event')
    // Every result event precedes the terminal event in stream order.
    const order = seq.map(e => e.envelope.kind + ':' + (e.payload?.event ?? e.payload?.reason ?? ''))
    const lastResult = order.lastIndexOf('shell.trace:tool.result')
    const termIdx = order.findIndex(o => o.startsWith('terminal:'))
    assert.ok(lastResult >= 0 && lastResult < termIdx, 'completion settles before the terminal event, not at it')
    assert.deepEqual(rows.map(r => r.payload.label), ['Read working directory', 'List project files'])
    assert.equal(seq.at(-1).payload.reason, 'completed')
  }
  // Unknown native alias fails closed with a terminal error, never dispatch.
  {
    const bogus = (adapter) => {
      if (adapter === 'anthropic') return { content: [{ type: 'tool_use', id: 'toolu-bogus', name: 'drop_tables', input: { cmd: 'pwd' } }] }
      if (adapter === 'openai') return { output: [{ type: 'function_call', call_id: 'call-bogus', name: 'drop_tables', arguments: JSON.stringify({ cmd: 'pwd' }) }] }
      return { choices: [{ message: { content: null, tool_calls: [{ id: 'call-bogus', type: 'function', function: { name: 'drop_tables', arguments: JSON.stringify({ cmd: 'pwd' }) } }] } }] }
    }
    for (const adapter of ['openrouter', 'openai', 'anthropic']) {
      reply = bogus(adapter)
      const res = await fetch(base + '/?/ai_stream', { method: 'POST', headers: { accept: 'text/event-stream' }, body: new URLSearchParams({ adapter, model: 'fixture-tool', prompt: 'pwd please', drive: '0', continuation: '' }) })
      assert.ok((await res.text()).includes('unknown native tool alias'), adapter + ': bogus alias fails closed')
    }
  }
  // P1: strict OpenRouter second-request arguments encoding. After the first
  // native execution the assistant message must carry `arguments` as a JSON
  // STRING (object form is a wire violation). Two-round fixture: tool then
  // done, asserting the linked `tool_calls` fragment on the second request.
  {
    let calls = 0
    reply = req => {
      const body = JSON.stringify(req)
      if (calls++ === 0) return { choices: [{ message: { content: null, tool_calls: [{ id: 'call-strict-1', type: 'function', function: { name: qAlias, arguments: JSON.stringify({ cmd: 'pwd' }) } }] } }] }
      return { choices: [{ message: { content: `Our console is in ${dir}.` } }] }
    }
    const strictEv = await run('Where is our console?', false, '', 'openrouter', 'fixture-tool')
    assert.equal(strictEv.at(-1).payload.reason, 'completed')
    assert.ok(strictEv.some(e => e.payload.text === `Our console is in ${dir}.`), 'strict fixture answers')
    const secondReq = requests.at(-1)
    const secondBody = JSON.stringify(secondReq)
    assert.ok(secondBody.includes('call-strict-1'), 'second request links the tool call')
    // The assistant handoff message: arguments must be a quoted JSON string.
    const m = secondBody.match(/"arguments"\s*:\s*("(?:[^"\\]|\\.)*"|\{[^}]*\})/)
    assert.ok(m, 'handoff carries arguments, got: ' + secondBody.slice(0, 400))
    assert.ok(m[1].startsWith('"'), 'P1: OpenRouter handoff arguments is a JSON string, got: ' + m[1].slice(0, 120))
    const parsed = JSON.parse(JSON.parse(m[1]))
    assert.deepEqual(parsed, { cmd: 'pwd' }, 'handoff arguments decode to the executed call')
  }
  // Capability gate: a text-only model id gets a clear error before a run.
  reply = tool('shell_query', { cmd: 'pwd' })
  {
    // Native-shaped reply on a text-only model: must fail closed with the
    // capability error, never dispatch or leak.
    const qn = 'backend.shell_tools.tool_shell_query'
    reply = () => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'call-x-1', function: { name: qn, arguments: '{"cmd":"pwd"}' } }] } }] })
    const res = await fetch(base + '/?/ai_stream', { method: 'POST', headers: { accept: 'text/event-stream' }, body: new URLSearchParams({ adapter: 'openrouter', model: 'text-only-fixture', prompt: 'pwd please', drive: '0', continuation: '' }) })
    const text = await res.text()
    assert.ok(text.includes('does not advertise native tool calls'), 'capability error must surface: ' + text.slice(0, 300))
  }
 } finally {
  proc.kill('SIGTERM'); try { await Promise.race([once(proc, 'exit'), new Promise(r => setTimeout(r, 2000))]) } catch {}; if (proc.exitCode === null) { try { proc.kill('SIGKILL') } catch {} }
  await new Promise(r => provider.close(r)); await rm(dir, { recursive: true, force: true })
 }
})
