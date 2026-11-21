<script lang="ts">
import { tick } from 'svelte'
import { browser, dev } from '#app/environment'
import {
	DeterministicAdapter,
	DraftStore,
	RunTracker,
	capabilityFailure,
	createMemorySink,
	routeAdapter,
} from '@swelte/ai'
import { ApprovalStore, authorizeShellCall, runAllowlisted } from '#lib/shell.js'
import { approve, chat, deny, exec, send_input, stream } from '#routes/shell/ai/+page.v'
import { term as termUrl } from '#routes/shell/ai/+page.v'

interface ChatMsg {
	id: string
	role: 'user' | 'assistant'
	body: string
}

interface PendingApproval {
	opId: string
	cmd: string
	status: 'pending' | 'approved' | 'denied' | 'expired'
	note: string
}

interface TermLine {
	id: number
	prompt: string
	body: string
}

let composer = $state('')
let termKeys = $state('')
let status = $state<'idle' | 'running' | 'done' | 'error'>('idle')
let activeTurn = $state('turn-1')
let turnSeq = $state(1)
let verdict = $state('')
let note = $state('')
let approvalTtl = $state('300000')
let termLines: TermLine[] = $state([])
let messages: ChatMsg[] = $state([])
let approvals: PendingApproval[] = $state([])
let streaming = $state(false)
let watching = $state(false)
let connected = $state(false)
let ws: WebSocket | null = null
let msgSeq = 0
let opSeq = 0
let lineSeq = 0
let traceFilter = $state('')
let termEl: HTMLElement | null = null
const store = new ApprovalStore()
const card = new DraftStore({ title: '', note: '' })
const sink = createMemorySink()
const tracker = new RunTracker()
const nextOp = () => `op-${Date.now().toString(36)}-${(opSeq += 1)}`

const ALLOWLIST = ['echo', 'pwd', 'whoami', 'help']

function showError(e: unknown) {
	note = e instanceof Error ? e.message : String(e)
}

function pushTerm(prompt: string, body: string) {
	lineSeq += 1
	termLines = [...termLines.slice(-199), { id: lineSeq, prompt, body }]
	tick().then(() => {
		termEl?.scrollTo({ top: termEl.scrollHeight })
	})
}

function pushLine(line: string) {
	const nl = line.indexOf('\n')
	if (line.startsWith('$ ') && nl > 0) pushTerm(line.slice(0, nl), line.slice(nl + 1))
	else pushTerm('', line)
}

function pushMsg(role: ChatMsg['role'], body: string) {
	msgSeq += 1
	messages = [...messages, { id: `m-${msgSeq}`, role, body }]
}

async function runHumanCommand(raw: string) {
	const cmd = raw.trim()
	if (!cmd) return
	const gate = authorizeShellCall('human', cmd)
	if (!gate.allowed) {
		pushTerm(`$ ${cmd}`, gate.reason)
		pushMsg('assistant', gate.reason)
		return
	}
	try {
		const res = await exec({ cmd, op_id: nextOp(), caller: 'human' })
		pushTerm(`$ ${cmd}`, res.output)
		sink.record({
			runId: 'run-shell',
			turnId: activeTurn,
			outputId: 'out-shell',
			seq: res.seq,
			kind: 'text.delta',
		})
	} catch (e) {
		showError(e)
	}
}
async function sendChat() {
	const text = composer.trim()
	if (!text || streaming) return
	composer = ''
	streaming = true
	status = 'running'
	note = ''
	pushMsg('user', text)
	try {
		const adapter = routeAdapter({ input: ['text'], output: ['text'] }, [
			Object.assign(new DeterministicAdapter(), { latencyMs: 5 }),
		])
		if (!adapter) throw new Error(capabilityFailure({ input: ['text'], output: ['text'] }, []))
		let reply = ''
		for await (const event of adapter.run(text, { input: ['text'], output: ['text'] })) {
			if (event.envelope.kind === 'text.delta') reply += (event.payload as { text: string }).text
			if (event.envelope.kind === 'terminal') tracker.finish('completed', event.envelope.seq)
			await tick()
		}
		const res = await chat({ msg: text })
		pushLine(res.output)
		pushMsg('assistant', reply)
		card.applyPatch({
			expectedRevision: card.current.revision,
			ops: [{ op: 'set', path: ['title'], value: text.slice(0, 40) }],
		})
		sink.record({
			runId: 'run-shell',
			turnId: activeTurn,
			outputId: 'out-text',
			seq: res.seq,
			kind: 'terminal',
			terminal: 'completed',
		})
		verdict = capabilityFailure({ input: ['video'], output: ['text'] }, [])
		status = 'done'
	} catch (e) {
		showError(e)
		status = 'error'
	} finally {
		streaming = false
	}
}

function interrupt() {
	tracker.endOutput('out-text')
	sink.record({
		runId: 'run-shell',
		turnId: activeTurn,
		outputId: 'out-text',
		seq: 999,
		kind: 'terminal',
		terminal: 'interrupted',
		cancellation: { requested: true },
	})
	turnSeq += 1
	activeTurn = `turn-${turnSeq}`
	pushMsg('assistant', `interrupted — continuing in ${activeTurn}; stale output rejected.`)
	status = 'idle'
}

async function proposeAi(cmd: string) {
	const gate = authorizeShellCall('ai', cmd)
	if (!gate.needsApproval) {
		await runHumanCommand(cmd)
		return
	}
	const opId = nextOp()
	store.request('ai', cmd, opId)
	try {
		await exec({ cmd, op_id: opId, caller: 'ai' })
	} catch (e) {
		note = e instanceof Error ? e.message : String(e)
	}
	approvals = [...approvals, { opId, cmd, status: 'pending', note: 'waiting for human approval' }]
}

async function decide(opId: string, allow: boolean) {
	const item = approvals.find((a) => a.opId === opId)
	if (!item) return
	const ttl = Number.parseInt(approvalTtl, 10)
	if (Number.isFinite(ttl) && ttl < 0) {
		item.status = 'expired'
		item.note = 'approval expired before decision'
		approvals = [...approvals]
		return
	}
	try {
		if (allow) await approve({ cmd: item.cmd, op_id: opId, caller: 'ai' })
		else await deny({ cmd: item.cmd, op_id: opId, caller: 'ai' })
		store.decide(opId, allow ? 'approved' : 'denied')
		if (allow) {
			const res = await exec({ cmd: item.cmd, op_id: opId, caller: 'ai' })
			pushTerm(`$ ${item.cmd}`, `${res.output} — approved by human`)
			pushMsg('assistant', `approved + ran: ${item.cmd} → ${res.output}`)
		} else {
			pushMsg('assistant', `denied: ${item.cmd}`)
		}
		item.status = allow ? 'approved' : 'denied'
		item.note = allow ? 'executed once; duplicates replay the receipt' : 'denied by human'
		approvals = [...approvals]
	} catch (e) {
		showError(e)
	}
}
async function watchShell() {
	if (watching) return
	watching = true
	try {
		for await (const line of stream({})) {
			if (!watching) break
			if (line === '__ping__') continue
			pushLine(line)
			await tick()
		}
	} catch (e) {
		showError(e)
	} finally {
		watching = false
	}
}

function stopShell() {
	watching = false
}

function wsBase() {
	if (browser && dev) {
		const http =
			import.meta.env.SWELTE_V_BACKEND_URL ??
			import.meta.env.VITE_SWELTE_V_BACKEND_URL ??
			'http://localhost:8131'
		return String(http).replace(/^http/, 'ws')
	}
	return ''
}

function wsUrl(url: string) {
	const base = wsBase()
	if (!base) return url
	try {
		const rebased = new URL(url, location.href)
		const backend = new URL(base)
		rebased.protocol = backend.protocol
		rebased.host = backend.host
		return rebased.toString()
	} catch {
		return url
	}
}

function openTerm() {
	closeTerm()
	const sock = new WebSocket(wsUrl(termUrl({})))
	sock.onopen = () => {
		connected = true
		pushTerm('', '— terminal connected —')
	}
	sock.onclose = () => {
		connected = false
	}
	sock.onmessage = (ev) => pushLine(String(ev.data))
	sock.onerror = () => {
		note = 'terminal socket error'
	}
	ws = sock
}

function closeTerm() {
	try {
		ws?.close()
	} catch {}
	ws = null
	connected = false
}

async function sendKeys() {
	const keys = termKeys
	if (!keys) return
	termKeys = ''
	try {
		await send_input({ keys, op_id: nextOp(), caller: 'human' })
		pushTerm('>', keys)
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(keys)
	} catch (e) {
		showError(e)
	}
}

function aiDemo() {
	void proposeAi('echo hello-from-ai')
}

function runQuick(cmd: string) {
	void runHumanCommand(cmd)
}

let pending = $derived(approvals.filter((a) => a.status === 'pending'))
let traceShown = $derived(
	traceFilter.trim()
		? sink.events.filter((e) => JSON.stringify(e).includes(traceFilter.trim()))
		: sink.events
)
let statusClass = $derived(
	status === 'done' ? 'ok' : status === 'error' ? 'bad' : status === 'running' ? 'run' : ''
)
</script>
<main class="shell">
	<header class="hero">
		<div>
			<p class="kicker">swelte · @swelte/ai · shared backend shell</p>
			<h1>shell/ai</h1>
			<p class="lede">
				One allowlisted backend shell, two faces. Humans type and run instantly; AI proposals wait
				in the approval queue and execute exactly once. Try <code>help</code> in either pane.
			</p>
		</div>
		<div class="statusbar">
			<span class="pill {statusClass}">{status}</span>
			<span class="pill">turn {activeTurn}</span>
			<span class="pill">card “{card.current.value.title || '—'}”</span>
			<span class="pill">{sink.events.length} trace events</span>
			<a class="home" href="/">← home</a>
		</div>
	</header>

	<section class="grid">
		<section class="panel term">
			<div class="panel-head">
				<h2>terminal</h2>
				<span class="conn {connected ? 'on' : watching ? 'watch' : ''}">
					{connected ? '● live socket' : watching ? '● watching SSE' : '○ idle'}
				</span>
			</div>
			<div class="toolbar">
				<button onclick={watchShell} disabled={watching}>watch SSE</button>
				<button onclick={stopShell} disabled={!watching}>stop</button>
				<button onclick={openTerm} disabled={connected}>open socket</button>
				<button onclick={closeTerm} disabled={!connected}>close</button>
			</div>
			<div
				class="screen"
				bind:this={termEl}
				role="log"
				aria-live="polite"
				aria-label="terminal output"
			>
				{#if !termLines.length}
					<p class="dim">shell idle — watch it or run a command below.</p>
				{/if}
				{#each termLines as l (l.id)}
					<div class="line">
						{#if l.prompt}
							<span class="prompt">{l.prompt}</span>
						{/if}
						<span class="body">{l.body}</span>
					</div>
				{/each}
			</div>
			<form
				class="inputrow"
				onsubmit={(e) => {
					e.preventDefault()
					sendKeys()
				}}
			>
				<span class="ps1">›</span>
				<input bind:value={termKeys} placeholder="echo hi" aria-label="terminal input">
				<button type="submit">send keys</button>
				<button type="button" onclick={() => runHumanCommand(termKeys || 'help')}>run</button>
			</form>
			<div class="quick">
				{#each ALLOWLIST as c (c)}
					<button class="chip" onclick={() => runQuick(c === 'echo' ? 'echo hello shell' : c)}>
						{c}
					</button>
				{/each}
			</div>
		</section>

		<section class="panel chat">
			<div class="panel-head">
				<h2>chat</h2>
				{#if streaming}
					<span class="typing">streaming…</span>
				{/if}
			</div>
			<div class="msgs" role="log" aria-live="polite" aria-label="conversation">
				{#if !messages.length}
					<p class="dim">Say hello — the deterministic adapter echoes it straight back.</p>
				{/if}
				{#each messages as m (m.id)}
					<div class="msg {m.role}">
						<span class="who">{m.role}</span>
						<span>{m.body}</span>
					</div>
				{/each}
			</div>
			<form
				class="inputrow"
				onsubmit={(e) => {
					e.preventDefault()
					sendChat()
				}}
			>
				<input bind:value={composer} placeholder="say hello" aria-label="chat message">
				<button type="submit" disabled={streaming}>send</button>
				<button type="button" onclick={interrupt}>interrupt</button>
				<button type="button" class="ghost" onclick={aiDemo}>AI: echo hello-from-ai</button>
			</form>
			{#if verdict}
				<p class="dim small">capability probe: {verdict}</p>
			{/if}

			<h3 class="sub">approvals <span class="count">{pending.length} pending</span></h3>
			<p class="dim small">
				Gate: caller + exact args + op id.
				<label>ttl ms <input class="ttl" bind:value={approvalTtl}></label> (negative forces expiry)
			</p>
			{#if !approvals.length}
				<p class="dim">No proposals yet — click “AI: echo hello-from-ai”.</p>
			{/if}
			{#each approvals as a (a.opId)}
				<div class="approval {a.status}">
					<div class="a-main">
						<code>shell.exec</code>
						<code class="cmd">{a.cmd}</code>
						<span class="pill {a.status}">{a.status}</span>
					</div>
					<div class="a-sub">{a.note} · <code>{a.opId}</code></div>
					{#if a.status === 'pending'}
						<div class="a-actions">
							<button onclick={() => decide(a.opId, true)}>approve + run once</button>
							<button class="ghost" onclick={() => decide(a.opId, false)}>deny</button>
						</div>
					{/if}
				</div>
			{/each}
		</section>
	</section>
	<section class="panel trace">
		<div class="panel-head">
			<h2>trace</h2>
			<label class="dim small">filter <input bind:value={traceFilter} placeholder="turn-1"></label>
		</div>
		<p class="dim small">
			Every run records run / turn / output ids, sequence, kind and terminal outcome —
			<code>createMemorySink</code> from <code>@swelte/ai</code>. Usage vs. estimate stay distinct.
		</p>
		<pre class="tracebody">{traceShown.length
	? traceShown
			.map((e) => `${e.runId} ${e.turnId ?? '-'} ${e.outputId} #${e.seq} ${e.kind}`)
			.join('\n')
	: '(no events yet)'}</pre>
	</section>

	{#if note}
		<p class="note">{note}</p>
	{/if}
	<p class="foot dim small">
		local preview of <code>runAllowlisted('echo hi') = {runAllowlisted('echo hi')}</code>
	</p>
</main>

<style>
.shell {
	max-width: 72rem;
	margin: 0 auto;
	padding: 2rem 1.25rem 3rem;
	font-family: ui-sans-serif, system-ui, sans-serif;
	color: #e8eaf0;
	background: #12141f;
	min-height: 100vh;
}
.kicker {
	text-transform: uppercase;
	letter-spacing: 0.14em;
	font-size: 0.72rem;
	color: #9aa3c7;
	margin: 0 0 0.25rem;
}
h1 {
	font-size: 2.4rem;
	margin: 0;
	letter-spacing: -0.02em;
}
.lede {
	color: #b9bfd6;
	max-width: 46rem;
}
.lede code {
	color: #8ef0b2;
}
.statusbar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	align-items: center;
	margin-top: 1rem;
}
.pill {
	font-size: 0.75rem;
	padding: 0.2rem 0.6rem;
	border-radius: 999px;
	border: 1px solid #3a4066;
	background: #1a1e33;
	color: #c6ccea;
}
.pill.run {
	border-color: #6aa8ff;
	color: #bcd6ff;
}
.pill.ok {
	border-color: #3fce7e;
	color: #b9f4d2;
}
.pill.bad,
.pill.denied,
.pill.expired {
	border-color: #ff7a7a;
	color: #ffc9c9;
}
.pill.approved {
	border-color: #3fce7e;
	color: #b9f4d2;
}
.pill.pending {
	border-color: #e0a63c;
	color: #ffe1a8;
}
.home {
	margin-left: auto;
	color: #9aa3c7;
}
.grid {
	display: grid;
	grid-template-columns: 1.1fr 1fr;
	gap: 1rem;
	margin-top: 1.5rem;
}
@media (max-width: 60rem) {
	.grid {
		grid-template-columns: 1fr;
	}
}
.panel {
	border: 1px solid #2c3252;
	border-radius: 0.9rem;
	background: #101322;
	padding: 1rem;
}
.panel-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1rem;
}
.panel-head h2 {
	margin: 0;
	font-size: 1rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: #9aa3c7;
}
.conn {
	font-size: 0.78rem;
	color: #7c86ab;
}
.conn.watch {
	color: #ffd98a;
}
.conn.on {
	color: #8ef0b2;
}
.toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin: 0.75rem 0;
}
button {
	background: #2b3f8f;
	color: white;
	border: 1px solid #4a5fb5;
	border-radius: 0.5rem;
	padding: 0.42rem 0.8rem;
	cursor: pointer;
	font-size: 0.85rem;
}
button:disabled {
	opacity: 0.45;
	cursor: default;
}
button.ghost {
	background: transparent;
	border-color: #3a4066;
	color: #c6ccea;
}
.screen {
	background: #07090f;
	border: 1px solid #232842;
	border-radius: 0.6rem;
	padding: 0.7rem;
	height: 16rem;
	overflow: auto;
	font-family: ui-monospace, Menlo, monospace;
	font-size: 0.82rem;
	line-height: 1.45;
}
.line {
	white-space: pre-wrap;
	word-break: break-word;
}
.prompt {
	color: #8ef0b2;
	margin-right: 0.5ch;
}
.body {
	color: #d7dbee;
}
.dim {
	color: #7c86ab;
}
.small {
	font-size: 0.8rem;
}
.inputrow {
	display: flex;
	gap: 0.5rem;
	margin-top: 0.75rem;
	align-items: center;
}
.inputrow input {
	flex: 1;
	background: #0d1120;
	border: 1px solid #2c3252;
	color: #e8eaf0;
	border-radius: 0.5rem;
	padding: 0.5rem 0.7rem;
	font-size: 0.9rem;
}
.ps1 {
	color: #8ef0b2;
	font-family: ui-monospace, Menlo, monospace;
}
.quick {
	display: flex;
	gap: 0.4rem;
	margin-top: 0.6rem;
	flex-wrap: wrap;
}
.chip {
	background: #141a33;
	border-color: #2c3252;
	font-family: ui-monospace, Menlo, monospace;
	font-size: 0.78rem;
}
.msgs {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	max-height: 14rem;
	overflow: auto;
	margin-top: 0.75rem;
}
.msg {
	border: 1px solid #2c3252;
	border-radius: 0.6rem;
	padding: 0.5rem 0.7rem;
	background: #10142a;
}
.msg.assistant {
	background: #12241a;
	border-color: #234d35;
}
.who {
	display: inline-block;
	font-size: 0.7rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: #9aa3c7;
	margin-right: 0.5rem;
}
.typing {
	font-size: 0.8rem;
	color: #ffd98a;
}
.sub {
	margin: 1.1rem 0 0.25rem;
	font-size: 0.85rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: #9aa3c7;
}
.count {
	color: #ffd98a;
}
.ttl {
	width: 7rem;
	background: #0d1120;
	border: 1px solid #2c3252;
	color: #e8eaf0;
	border-radius: 0.4rem;
	padding: 0.2rem 0.5rem;
}
.approval {
	border: 1px solid #4d3d17;
	background: #221b0d;
	border-radius: 0.6rem;
	padding: 0.6rem 0.7rem;
	margin-top: 0.5rem;
}
.approval.approved {
	border-color: #234d35;
	background: #0e2117;
}
.approval.denied,
.approval.expired {
	border-color: #5c2323;
	background: #241112;
}
.a-main {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	flex-wrap: wrap;
}
.cmd {
	color: #ffd98a;
}
.a-sub {
	font-size: 0.78rem;
	color: #9aa3c7;
	margin-top: 0.25rem;
}
.a-actions {
	display: flex;
	gap: 0.5rem;
	margin-top: 0.5rem;
}
.trace {
	margin-top: 1rem;
}
.tracebody {
	background: #07090f;
	border: 1px solid #232842;
	border-radius: 0.6rem;
	padding: 0.7rem;
	max-height: 10rem;
	overflow: auto;
	font-size: 0.78rem;
	color: #9fe8bb;
	white-space: pre-wrap;
}
.note {
	color: #ffb3b3;
}
.foot {
	margin-top: 1rem;
}
.foot code {
	color: #8ef0b2;
}
</style>
