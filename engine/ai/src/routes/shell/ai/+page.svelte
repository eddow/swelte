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
} from '#lib/index.js'
import {
	ApprovalStore,
	authorizeShellCall,
	runAllowlisted,
} from '#routes/shell/ai/shell.js'
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

let composer = $state('')
let termKeys = $state('')
let status = $state('idle')
let activeTurn = $state('turn-1')
let turnSeq = $state(1)
let verdict = $state('')
let note = $state('')
let approvalTtl = $state('300000')
let shellLines: string[] = $state([])
let messages: ChatMsg[] = $state([])
let approvals: PendingApproval[] = $state([])
let streaming = $state(false)
let watching = $state(false)
let watchToken = 0
let ws: WebSocket | null = null
let msgSeq = 0
let opSeq = 0
const store = new ApprovalStore()
const card = new DraftStore({ title: '', note: '' })
const sink = createMemorySink()
const tracker = new RunTracker()
const nextOp = () => `op-${Date.now().toString(36)}-${(opSeq += 1)}`

function showError(e: unknown) {
	note = e instanceof Error ? e.message : String(e)
}

function pushLine(line: string) {
	shellLines = [...shellLines.slice(-199), line]
}

function pushMsg(role: ChatMsg['role'], body: string) {
	msgSeq += 1
	messages = [...messages, { id: `m-${msgSeq}`, role, body }]
}

async function runHumanCommand(cmd: string) {
	const gate = authorizeShellCall('human', cmd)
	if (!gate.allowed) {
		pushMsg('assistant', gate.reason)
		pushLine(`$ ${cmd}\n${gate.reason}`)
		return
	}
	try {
		const res = await exec({ cmd, op_id: nextOp(), caller: 'human' })
		pushLine(`$ ${cmd}\n${res.output}`)
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
			pushLine(`$ ${item.cmd}\n${res.output} (approved by human)`)
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
	const token = ++watchToken
	watching = true
	try {
		for await (const line of stream({})) {
			if (token !== watchToken) break
			if (line === '__ping__') continue
			pushLine(line)
			await tick()
		}
	} catch (e) {
		if (token === watchToken) showError(e)
	} finally {
		if (token === watchToken) watching = false
	}
}

function stopShell() {
	watchToken += 1
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
}

async function sendKeys() {
	const keys = termKeys
	if (!keys) return
	termKeys = ''
	try {
		await send_input({ keys, op_id: nextOp(), caller: 'human' })
		pushLine(keys)
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(keys)
	} catch (e) {
		showError(e)
	}
}

function aiDemo() {
	void proposeAi('echo hello-from-ai')
}
</script>

<main>
	<h1>shell/ai dogfood — one backend shell, chat + terminal</h1>
	<p>
		Dogfood only, never published. Human keystrokes and AI-proposed commands share the allowlisted
		backend shell (<code>echo pwd whoami help</code>); AI side effects wait for an in-chat approval.
		Type <code>help</code> in either pane.
	</p>
	<p>
		<label>chat <input bind:value={composer} placeholder="say hello"></label>
		<button onclick={sendChat} disabled={streaming}>send chat</button>
		<button onclick={interrupt}>interrupt</button>
		<button onclick={aiDemo}>AI proposes: echo hello-from-ai</button>
	</p>
	{#if verdict}
		<p>video check: {verdict}</p>
	{/if}
	<p>
		status: {status} · active turn: {activeTurn} · card: {card.current.value.title || '(empty)'} ·
		trace events: {sink.events.length}
	</p>

	<h2>conversation</h2>
	<div
		role="log"
		aria-live="polite"
		style="border:1px solid #ccc; max-height:12rem; overflow:auto; padding:0.5rem;"
	>
		{#if !messages.length}
			<p><em>Start a conversation — ask or run a command.</em></p>
		{/if}
		{#each messages as m (m.id)}
			<p><strong>{m.role}:</strong> {m.body}</p>
		{/each}
		{#if streaming}
			<p><em>streaming…</em></p>
		{/if}
	</div>

	<h2>approvals (PTC gate: caller + exact args + op id)</h2>
	<p>
		<label>approval ttl ms <input bind:value={approvalTtl}></label> (negative forces expiry)
	</p>
	{#if !approvals.length}
		<p><em>No pending approvals.</em></p>
	{/if}
	{#each approvals as a (a.opId)}
		<div style="border:1px solid #c90; padding:0.5rem; margin:0.25rem 0;">
			<p>
				<strong>shell.exec</strong> <code>{a.cmd}</code> — {a.status} · {a.note} ·
				<code>{a.opId}</code>
			</p>
			{#if a.status === 'pending'}
				<button onclick={() => decide(a.opId, true)}>approve + run once</button>
				<button onclick={() => decide(a.opId, false)}>deny</button>
			{/if}
		</div>
	{/each}

	<h2>terminal (shares the backend shell over SSE/WS)</h2>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={watchShell} disabled={watching}>watch shell (SSE)</button>
		<button onclick={stopShell}>stop</button>
		<button onclick={openTerm}>open terminal (WS)</button>
		<button onclick={closeTerm}>close terminal</button>
	</div>
	<pre
		style="background:#111; color:#0f0; padding:0.5rem; max-height:12rem; overflow:auto;"
	>{shellLines.join('\n') || '(shell idle — watch or send a command)'}</pre>
	<p>
		<label>terminal input <input bind:value={termKeys} placeholder="echo hi"></label>
		<button onclick={sendKeys}>send keys (human PTC)</button>
		<button onclick={() => runHumanCommand(termKeys || 'help')}>run as command</button>
	</p>
	{#if note}
		<p>{note}</p>
	{/if}
	<p>
		<a href="/">back</a> · local preview of
		<code>runAllowlisted('echo hi') = {runAllowlisted('echo hi')}</code>
	</p>
</main>
