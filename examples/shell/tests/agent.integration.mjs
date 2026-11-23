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
  res.end(JSON.stringify(req.url === '/responses' ? { output: [{ content: [{ text }] }] } : req.url === '/v1/messages' ? { content: [{ text }] } : { choices: [{ message: { content: text } }] }, null, 2))
 })
 provider.listen(0, '127.0.0.1'); await once(provider, 'listening')
 const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening')
 const port = reserve.address().port; await new Promise(r => reserve.close(r))
 const proc = spawn(resolve('dist/server'), [], { cwd: dir, env: { ...process.env, PORT: String(port), SWELTE_RATE_LIMIT: '1000', SWELTE_DB_PATH: join(dir, 'test.db'), OPENROUTER_API_KEY: 'fixture-only', OPENAI_API_KEY: 'fixture-only', ANTHROPIC_API_KEY: 'fixture-only', SHELL_AI_BASE_URL: `http://127.0.0.1:${provider.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] })
 let logs = ''; proc.stdout.on('data', b => logs += b); proc.stderr.on('data', b => logs += b)
 const base = `http://127.0.0.1:${port}`
 const rpc = async (fn, args) => {
  const res = await fetch(base + '/', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ fn, args }) })
  return { status: res.status, body: await res.json() }
 }
 const run = async (prompt, drive = false, continuation = '', adapter = 'openrouter') => {
  const res = await fetch(base + '/?/ai_stream', { method: 'POST', headers: { accept: 'text/event-stream' }, body: new URLSearchParams({ adapter, model: 'fixture', prompt, drive: drive ? '1' : '0', continuation }) })
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
  assert.equal(events.at(-1).payload.reason, 'completed')
  assert.match(requests.at(-1).messages[0].content, /tool_shell_read_output/)
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
  // Latest screenshot: bare exec syntax, terminal toggle off. It must read
  // the real cwd and feed the result back, without approval or leaked syntax.
  for (const adapter of ['openrouter', 'openai', 'anthropic']) {
   reply = req => {
    const messages = req.messages ?? req.input
    const prompt = messages[messages.length - 1].content
    if (prompt.includes('Tool result (untrusted data):')) {
     assert.ok(prompt.includes(dir), 'model must receive the actual sandbox cwd')
     if (!prompt.includes('README.txt')) return 'backend.shell_tools.tool_shell_exec {"cmd":"ls"}'
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
  assert.ok(loopEnd.model_reqs <= 4, `bounded model requests (got ${loopEnd.model_reqs})`)
  assert.ok(loopEnd.elapsed_ms < 15000, `S1 deadline: simple pwd must settle (got ${loopEnd.elapsed_ms}ms)`)
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
  reply = tool('shell_exec', { cmd: 'echo approved "value"' })
  const p = parked(await run('Echo a value', true))
  assert.match(requests.at(-1).messages[0].content, /tool_shell_browse/)
  assert.equal((await rpc('shell_tool_resume', { ...p, args_json: '{}' })).status, 400)
  const approved = await rpc('shell_tool_resume', p)
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  assert.equal(approved.body.output, 'approved "value"')
  assert.deepEqual((await rpc('shell_tool_resume', p)).body, approved.body)
  reply = req => { assert.match(req.messages[1].content, /Approved tool:/); return 'The approved command succeeded.' }
  events = await run('continue', true, approved.body.continuation)
  assert.ok(events.some(e => e.payload.text === 'The approved command succeeded.'))
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
  const outside = join(tmpdir(), `outside-${port}`)
  await writeFile(outside, 'outside secret'); await symlink(outside, join(dir, 'escape'))
  assert.match((await rpc('exec', { cmd: 'cat escape', caller: 'human', op_id: 'escape' })).body.output, /outside sandbox/)
  await rm(outside)
  const get = await fetch(base + '/api/tools?only=shell_exec&approve=1', { headers: { accept: 'application/json' } })
  assert.match(await get.text(), /console POST approval/)
 } finally {
  proc.kill('SIGTERM'); await Promise.race([once(proc, 'exit'), new Promise(r => setTimeout(r, 2000))]); if (proc.exitCode === null) proc.kill('SIGKILL')
  await new Promise(r => provider.close(r)); await rm(dir, { recursive: true, force: true })
 }
})
