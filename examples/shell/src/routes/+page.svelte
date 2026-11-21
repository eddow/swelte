<script lang="ts">
import { tick } from 'svelte'
import {
	DeterministicAdapter,
	DraftStore,
	RunTracker,
	capabilityFailure,
	createMemorySink,
	routeAdapter,
} from '@swelte/ai'
import { applyTheme, setTheme, storedTheme, type Theme } from '#lib/theme.js'
import { ApprovalStore, authorizeShellCall, runAllowlisted } from '#lib/shell.js'
import { onMount } from 'svelte'
import { approve, chat, deny, exec, stream } from '#routes/+page.v'

interface ChatMsg {
	id: string
	role: 'user' | 'assistant'
	body: string
	author?: string
	meta?: string
	pending?: boolean
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
// Exec lifecycle: while an exec is in flight the input forwards keystrokes
// to its stdin (send_input) instead of starting a new command; the run
// button is enabled only when idle with non-empty input and no chat reply
// streaming.
let execRunning = $state(false)
// Single output path: the page auto-subscribes to the backend room over
// SSE on mount (client-only page, `export const ssr = false`). No connect
// buttons, no WS socket — one wire, painted once.
let live = $state(false)
let msgSeq = 0
let opSeq = 0
let lineSeq = 0
// Painted frames: RPC calls paint optimistically from their return value
// (instant feedback); the SSE echo of the same frame is dropped here, so
// nothing ever displays twice.
let seenFrames = new Set<string>()
let traceFilter = $state('')
let termEl: HTMLElement | null = null
let chatEl: HTMLElement | null = null
// Follow-state: auto-follow only while the reader is at the bottom
// (Baby UI `conversation` rule — never yank a reader off earlier
// content). Detaching surfaces a jump-to-latest button instead.
let chatFollowing = $state(true)
let termFollowing = $state(true)
let dark = $state(false)
const store = new ApprovalStore()
const card = new DraftStore({ title: '', note: '' })
const sink = createMemorySink()
const tracker = new RunTracker()
const nextOp = () => `op-${Date.now().toString(36)}-${(opSeq += 1)}`

function showError(e: unknown) {
	note = e instanceof Error ? e.message : String(e)
}

function isNearBottom(el: HTMLElement | null) {
	if (!el) return true
	return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function followChat() {
	if (chatFollowing)
		tick().then(() => {
			chatEl?.scrollTo({ top: chatEl.scrollHeight })
		})
}

function followTerm() {
	if (termFollowing)
		tick().then(() => {
			termEl?.scrollTo({ top: termEl.scrollHeight })
		})
}

function pushTerm(prompt: string, body: string) {
	lineSeq += 1
	termLines = [...termLines.slice(-199), { id: lineSeq, prompt, body }]
	followTerm()
}

function paintExec(cmd: string, output: string) {
	// Single paint for one exec frame, optimistic or echoed — first call
	// wins, the twin is dropped. Commands and output always stay paired.
	const frame = `exec\n${cmd}\n${output}`
	if (seenFrames.has(frame)) return
	seenFrames.add(frame)
	lineSeq += 1
	termLines = [...termLines.slice(-199), { id: lineSeq, prompt: `$ ${cmd}`, body: output }]
	followTerm()
}

function pushLine(line: string) {
	// Room protocol: `exec\n<cmd>\n<output>` or `chat\n<msg>`. The
	// terminal renders exec frames only — chat echoes stay in the chat
	// pane. Unframed (pre-v2) tails are dropped, never sniffed.
	const nl = line.indexOf('\n')
	const kind = nl < 0 ? '' : line.slice(0, nl)
	const rest = nl < 0 ? '' : line.slice(nl + 1)
	if (kind !== 'exec' && kind !== 'stdin') return
	if (kind === 'stdin') {
		// Keystroke echo: someone's stdin, painted dim — never a command.
		paintStdin(rest)
		return
	}
	const sep = rest.indexOf('\n')
	paintExec(sep < 0 ? rest : rest.slice(0, sep), sep < 0 ? '' : rest.slice(sep + 1))
}

// Single paint for a stdin echo line — optimistic or echoed, first wins.
function paintStdin(keys: string) {
	const frame = `stdin\n${keys}`
	if (seenFrames.has(frame)) return
	seenFrames.add(frame)
	lineSeq += 1
	termLines = [...termLines.slice(-199), { id: lineSeq, prompt: '›', body: keys }]
	followTerm()
}

function pushMsg(role: ChatMsg['role'], body: string, extra?: Partial<ChatMsg>) {
	msgSeq += 1
	messages = [...messages, { id: `m-${msgSeq}`, role, body, ...extra }]
	followChat()
	return `m-${msgSeq}`
}

function resolveMsg(id: string, patch: Partial<ChatMsg>) {
	messages = messages.map((m) => (m.id === id ? { ...m, ...patch } : m))
	followChat()
}

async function runHumanCommand(raw: string) {
	const cmd = raw.trim()
	if (!cmd || execRunning) return
	termKeys = ''
	const gate = authorizeShellCall('human', cmd)
	if (!gate.allowed) {
		// Local rejection: never published, so paint it directly as one
		// prompt line + one reason line — no string-sniffing involved.
		pushTerm(`$ ${cmd}`, '')
		pushTerm('', gate.reason)
		pushMsg('assistant', gate.reason)
		return
	}
	execRunning = true
	try {
		const res = await exec({ cmd, op_id: nextOp(), caller: 'human' })
		paintExec(cmd, res.output)
		sink.record({
			runId: 'run-shell',
			turnId: activeTurn,
			outputId: 'out-shell',
			seq: res.seq,
			kind: 'text.delta',
		})
	} catch (e) {
		showError(e)
	} finally {
		execRunning = false
	}
}

// Keystrokes for a running command's stdin. Painted optimistically as a
// `› keys` echo; the SSE `stdin` frame twin is dropped by the frame key.
async function sendKeystroke(raw: string) {
	const keys = raw.trim()
	if (!keys) return
	termKeys = ''
	try {
		await send_input({ keys })
		paintStdin(keys)
	} catch (e) {
		showError(e)
	}
}

// Single terminal submit: a running command gets keystrokes (stdin),
// an idle shell runs the typed command. The input clears on both.
function submitTerm() {
	if (execRunning) void sendKeystroke(termKeys)
	else void runHumanCommand(termKeys || 'help')
}
async function sendChat() {
	const text = composer.trim()
	if (!text || streaming) return
	composer = ''
	autoGrow()
	streaming = true
	status = 'running'
	note = ''
	// Pin the turn now: an interrupt mid-reply must attribute this exchange
	// to the turn it started on, not the one it settles on.
	const turn = activeTurn
	pushHistory(text)
	pushMsg('user', text, { meta: turn })
	const waitId = pushMsg('assistant', '…', { author: 'deterministic', meta: turn, pending: true })
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
		// Chat echoes live only in the chat pane and the SSE room now
		// carries a `chat` frame the terminal ignores — nothing to paint.
		resolveMsg(waitId, { body: reply || '(empty reply)', pending: false })
		card.applyPatch({
			expectedRevision: card.current.revision,
			ops: [{ op: 'set', path: ['title'], value: text.slice(0, 40) }],
		})
		sink.record({
			runId: 'run-shell',
			turnId: turn,
			outputId: 'out-text',
			seq: res.seq,
			kind: 'terminal',
			terminal: 'completed',
		})
		verdict = capabilityFailure({ input: ['video'], output: ['text'] }, [])
		status = 'done'
	} catch (e) {
		// Settle the transient bubble too — a failed turn must not hang
		// in its dimmed `…` state.
		resolveMsg(waitId, { body: 'send failed — try again', pending: false })
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
			paintExec(item.cmd, `${res.output} ✓ approved`)
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
// The single output path, started once on mount: subscribe to the backend
// room over SSE (scrollback tail first, then live lines). Every publish()
// from any RPC lands here exactly once — the RPC calls above paint
// optimistically with their seq, and those echoes are dropped in pushLine.
async function watchShell() {
	try {
		for await (const line of stream({})) {
			if (line === '__ping__') continue
			pushLine(line)
			await tick()
		}
	} catch (e) {
		live = false
		showError(e)
	}
}

function aiDemo() {
	void proposeAi('echo hello-from-ai')
}

// Recent user prompts (newest first, capped) for the history picker —
// picking one resends it verbatim.
let promptHistory = $state<string[]>([])
let composerEl: HTMLTextAreaElement | null = null

function pushHistory(text: string) {
	promptHistory = [text, ...promptHistory.filter((h) => h !== text)].slice(0, 20)
}

// Auto-grow the composer up to four lines, then scroll (ChatComposer rule:
// height follows content with no easing — an eased grow lags the caret).
function autoGrow() {
	const el = composerEl
	if (!el) return
	el.style.height = 'auto'
	const line = parseFloat(getComputedStyle(el).lineHeight || '20') || 20
	el.style.height = `${Math.min(el.scrollHeight, line * 4)}px`
	el.style.overflowY = el.scrollHeight > line * 4 ? 'auto' : 'hidden'
}

// Enter sends (Shift+Enter breaks the line); a composing Enter (IME)
// never submits — the chat-client convention.
function composerKeydown(e: KeyboardEvent) {
	if (
		e.key === 'Enter' &&
		!e.shiftKey &&
		!(e as KeyboardEvent & { isComposing?: boolean }).isComposing
	) {
		e.preventDefault()
		void sendChat()
	}
}

// Submit gate: the button is enabled only when submitting does something.
// Idle + non-empty starts the command (blocked while a chat reply streams);
// idle + empty runs `help`; running + non-empty forwards a stdin keystroke;
// running + empty is disabled.
let submitDisabled = $derived(
	termKeys.trim().length === 0 ? execRunning : !execRunning && streaming
)

let pending = $derived(approvals.filter((a) => a.status === 'pending'))
let traceShown = $derived(
	traceFilter.trim()
		? sink.events.filter((e) => JSON.stringify(e).includes(traceFilter.trim()))
		: sink.events
)
// Theme toggle: src/app.ts already applied the theme before hydration;
// just sync the control to it. SSR renders the default (light).
// The terminal subscribes to the backend room here too — one output path,
// started once, no connect buttons.
onMount(() => {
	try {
		const stored = storedTheme()
		const theme: Theme =
			stored ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
		dark = theme === 'dark'
		applyTheme(theme)
	} catch {
		/* private mode — default theme stands */
	}
	live = true
	void watchShell()
})

function toggleTheme(next: boolean) {
	dark = next
	setTheme(next ? 'dark' : 'light')
}
</script>
<main class="shell">
	<header class="shell-head">
		<div class="shell-title">
			<p class="shell-kicker">swelte · @swelte/ai · shared backend shell</p>
			<h1>shell</h1>
			<p class="shell-lede">
				One allowlisted backend shell, two faces. Humans type and run instantly; AI proposals wait
				in the approval queue and execute exactly once. Try
				<code>help</code> in either pane.
			</p>
		</div>
		<div class="shell-meta">
			<div class="badge badge-outline gap-2">
				<span class={`status-dot status-${status}`}></span>
				{status}
			</div>
			<div class="badge badge-outline">turn {activeTurn}</div>
			<div class="badge badge-outline">card &ldquo;{card.current.value.title || '—'}&rdquo;</div>
			<div class="badge badge-outline">{sink.events.length} trace events</div>
			<label class="swap swap-rotate btn btn-ghost btn-circle btn-sm" aria-label="Toggle dark mode">
				<input
					type="checkbox"
					checked={dark}
					onchange={(e) => toggleTheme(e.currentTarget.checked)}
				>
				<svg
					class="swap-off h-5 w-5 fill-current"
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
				>
					<title>Light mode</title>
					<path
						d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7A1,1,0,0,0,12,4V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05l.71-.71A1,1,0,0,0,7.76,7.76l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0A1,1,0,0,0,5.64,7.05ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"
					/>
				</svg>
				<svg
					class="swap-on h-5 w-5 fill-current"
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
				>
					<title>Dark mode</title>
					<path
						d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"
					/>
				</svg>
			</label>
		</div>
	</header>
	<section class="shell-split">
		<!-- left: chat — transcript + approval queue -->
		<section class="card pane" aria-label="chat">
			<div class="pane-head">
				<h2>chat</h2>
			</div>
			<div
				class="transcript"
				bind:this={chatEl}
				onscroll={() => (chatFollowing = isNearBottom(chatEl))}
				role="log"
				aria-live="polite"
				aria-label="conversation"
			>
				{#if !messages.length}
					<div class="pane-empty">
						<p class="pane-empty-title">Start a conversation</p>
						<p>Ask or say hello — the deterministic adapter echoes it straight back.</p>
					</div>
				{/if}
				{#each messages as m (m.id)}
					<div class={`bubble-row ${m.role} ${m.pending ? 'is-pending' : ''}`}>
						<div class={`chat ${m.role === 'user' ? 'chat-end' : 'chat-start'}`}>
							{#if m.author || m.meta}
								<div class="chat-header">
									{#if m.author}
										<span>{m.author}</span>
									{/if}
									{#if m.meta}
										<time>{m.meta}</time>
									{/if}
								</div>
							{/if}
							<div class={`chat-bubble ${m.role === 'user' ? 'chat-bubble-primary' : ''}`}>
								{m.body}
							</div>
						</div>
					</div>
				{/each}
			</div>
			{#if !chatFollowing}
				<button
					class="btn btn-sm btn-ghost jump"
					onclick={() => {
						chatFollowing = true
						followChat()
					}}
				>
					↓ latest
				</button>
			{/if}
			<form
				class="composerbar"
				onsubmit={(e) => {
					e.preventDefault()
					sendChat()
				}}
			>
				{#if promptHistory.length}
					<details class="history">
						<summary class="btn btn-ghost btn-sm" aria-label="Prompt history">↺</summary>
						<ul>
							{#each promptHistory as h (h)}
								<li>
									<button
										type="button"
										onclick={() => {
											composer = h
											autoGrow()
											composerEl?.focus()
										}}
									>
										{h}
									</button>
								</li>
							{/each}
						</ul>
					</details>
				{/if}
				<textarea
					class="composerinput"
					bind:this={composerEl}
					bind:value={composer}
					oninput={autoGrow}
					onkeydown={composerKeydown}
					placeholder="say hello ⏎ send · ⇧⏎ newline"
					aria-label="chat message"
					rows="1"
				></textarea>
				{#if streaming}
					<button class="btn btn-warning btn-sm composergo" type="button" onclick={interrupt}>
						■ stop
					</button>
				{:else}
					<button
						class="btn btn-primary btn-sm composergo"
						type="submit"
						disabled={!composer.trim()}
					>
						↑ send
					</button>
				{/if}
				<button class="btn btn-ghost btn-sm" type="button" onclick={aiDemo}>
					AI: echo hello-from-ai
				</button>
			</form>
			{#if verdict}
				<p class="pane-hint">capability probe: {verdict}</p>
			{/if}
			<h3 class="queue-head">
				approvals <span class="badge badge-warning badge-sm">{pending.length} pending</span>
			</h3>
			<p class="pane-hint">
				Gate: caller + exact args + op id.
				<label
					>ttl ms <input class="input input-bordered input-xs ttl" bind:value={approvalTtl}></label
				>
				(negative forces expiry)
			</p>
			{#if !approvals.length}
				<p class="pane-hint">No proposals yet — click “AI: echo hello-from-ai”.</p>
			{/if}
			<div class="queue" role="list" aria-label="approval queue">
				{#each approvals as a (a.opId)}
					<div class={`gate gate-${a.status}`} role="listitem">
						<div class="gate-main">
							<span class="badge badge-sm badge-ghost font-mono">shell.exec</span>
							<code class="gate-cmd">{a.cmd}</code>
							<span
								class={`badge badge-sm badge-${a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'error'}`}
								>{a.status}</span
							>
						</div>
						<div class="gate-sub">{a.note} · <code>{a.opId}</code></div>
						{#if a.status === 'pending'}
							<div class="gate-actions">
								<button class="btn btn-sm btn-primary" onclick={() => decide(a.opId, true)}>
									approve + run once
								</button>
								<button class="btn btn-sm btn-ghost" onclick={() => decide(a.opId, false)}>
									deny
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
		<!-- right: terminal — live backend shell, auto-subscribed on mount -->
		<section class="card pane" aria-label="terminal">
			<div class="pane-head">
				<h2>terminal</h2>
				<span class={`conn ${live ? 'watch' : ''}`}>
					{live ? '● live' : '○ idle'}
				</span>
			</div>
			<div
				class="screen"
				bind:this={termEl}
				onscroll={() => (termFollowing = isNearBottom(termEl))}
				role="log"
				aria-live="polite"
				aria-label="terminal output"
			>
				{#if !termLines.length}
					<p class="screen-idle">shell idle — run a command below.</p>
				{/if}
				{#each termLines as l (l.id)}
					<div class="line">
						{#if l.prompt}
							<div class="prompt">{l.prompt}</div>
						{/if}
						{#if l.body}
							<div class="output">{l.body}</div>
						{/if}
					</div>
				{/each}
			</div>
			{#if !termFollowing}
				<button
					class="btn btn-sm btn-ghost jump"
					onclick={() => {
						termFollowing = true
						followTerm()
					}}
				>
					↓ latest
				</button>
			{/if}
			<form
				class="promptbar"
				onsubmit={(e) => {
					e.preventDefault()
					submitTerm()
				}}
			>
				<span class="ps1" aria-hidden="true">{execRunning ? '…' : '›'}</span>
				<input
					class="promptinput"
					bind:value={termKeys}
					placeholder={execRunning ? 'type stdin for the running command…' : 'echo hi ⏎ run'}
					aria-label={execRunning ? 'stdin for the running command' : 'terminal command'}
				>
				<button
					class="btn btn-primary btn-sm promptgo"
					type="submit"
					disabled={submitDisabled}
					aria-label={execRunning ? 'send keystroke to stdin' : 'run command'}
				>
					{execRunning ? '···' : '⏎ run'}
				</button>
			</form>
			<details class="trace">
				<summary>trace <span class="badge badge-sm badge-ghost">{traceShown.length}</span></summary>
				<label class="pane-hint"
					>filter
					<input
						class="input input-bordered input-xs"
						bind:value={traceFilter}
						placeholder="turn-1"
					></label
				>
				<pre class="tracebody">{traceShown.length
	? traceShown
			.map((e) => `${e.runId} ${e.turnId ?? '-'} ${e.outputId} #${e.seq} ${e.kind}`)
			.join('\n')
	: '(no events yet)'}</pre>
			</details>
		</section>
	</section>
	{#if note}
		<div class="alert alert-error mt-4"><span>{note}</span></div>
	{/if}
	<p class="foot">
		local preview of <code>runAllowlisted('echo hi') = {runAllowlisted('echo hi')}</code>
	</p>
</main>
<style>
/* Shell example: Baby UI docs presentation on the repo's docs-site stack
	 * (daisyUI `light --default, dark` on <html data-theme>). All surfaces use
	 * daisyUI tokens — no hardcoded page colors — so the toggle re-themes the
	 * whole page. The terminal screen keeps its own dark glass in both
	 * themes: it is a terminal, after all. */
.shell {
	max-width: 80rem;
	margin-inline: auto;
	padding: 1.5rem 1.25rem 3rem;
	min-height: 100vh;
}
.shell-head {
	display: flex;
	flex-wrap: wrap;
	gap: 1rem;
	justify-content: space-between;
	align-items: flex-start;
}
.shell-kicker {
	text-transform: uppercase;
	letter-spacing: 0.14em;
	font-size: 0.72rem;
	opacity: 0.6;
	margin: 0 0 0.25rem;
}
.shell-head h1 {
	font-size: 2rem;
	margin: 0;
	letter-spacing: -0.02em;
}
.shell-lede {
	opacity: 0.7;
	max-width: 44rem;
	margin-bottom: 0;
}
.shell-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	align-items: center;
}
.status-dot {
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 999px;
	background: currentColor;
	opacity: 0.6;
}
.status-running {
	background: var(--color-info);
	animation: pulse 1s infinite;
}
.status-done {
	background: var(--color-success);
}
.status-error {
	background: var(--color-error);
}
/* Split screen: chat left, terminal right. Stacks below lg. */
.shell-split {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 1rem;
	margin-top: 1.25rem;
	align-items: start;
}
@media (max-width: 64rem) {
	.shell-split {
		grid-template-columns: minmax(0, 1fr);
	}
}
.pane {
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	min-height: 32rem;
}
.pane-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1rem;
}
.pane-head h2 {
	margin: 0;
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	opacity: 0.6;
}
.transcript,
.screen {
	height: 20rem;
	overflow: auto;
	scroll-behavior: smooth;
}
.transcript {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	padding-right: 0.25rem;
}
/* daisyUI chat trims bubble width on wide viewports; let turns breathe. */
.bubble-row .chat {
	--chat-bubble-max-width: 42rem;
}
.bubble-row.is-pending .chat-bubble {
	opacity: 0.55;
}
@keyframes rise-in {
	from {
		opacity: 0;
		transform: translateY(4px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}
.bubble-row {
	animation: rise-in 160ms ease-out;
}
/* Composer-spirited chat bar: history picker + auto-growing field + a
 * send/stop button that never moves. Card surface, daisyUI borders. */
.composerbar {
	display: flex;
	gap: 0.5rem;
	align-items: flex-end;
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	background: var(--color-base-100);
	padding: 0.4rem;
}
.composerbar:focus-within {
	border-color: var(--color-primary);
}
.composerinput {
	flex: 1;
	min-width: 0;
	background: transparent;
	border: 0;
	outline: 0;
	resize: none;
	font-size: 0.9rem;
	line-height: 1.4;
	max-height: none;
}
.composergo {
	flex-shrink: 0;
}
.composergo:disabled {
	opacity: 0.45;
}
.history {
	position: relative;
	flex-shrink: 0;
}
.history summary {
	list-style: none;
	cursor: pointer;
}
.history summary::-webkit-details-marker {
	display: none;
}
.history ul {
	position: absolute;
	bottom: calc(100% + 0.4rem);
	left: 0;
	z-index: 10;
	margin: 0;
	padding: 0.3rem;
	list-style: none;
	min-width: 12rem;
	max-width: 20rem;
	max-height: 12rem;
	overflow: auto;
	background: var(--color-base-100);
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	box-shadow: var(--shadow-md, 0 4px 12px rgb(0 0 0 / 0.15));
}
.history li button {
	display: block;
	width: 100%;
	text-align: left;
	font-size: 0.82rem;
	padding: 0.35rem 0.5rem;
	border-radius: calc(var(--radius-box) - 0.25rem);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.history li button:hover {
	background: var(--color-base-200);
}
.pane-empty {
	border: 1px dashed var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 1.25rem;
	opacity: 0.7;
}
.pane-empty-title {
	font-weight: 600;
	margin: 0 0 0.25rem;
}
.pane-empty p {
	margin: 0;
}
.jump {
	align-self: center;
}
/* Composer-spirited terminal prompt: one bordered bar — `›` prefix,
 * mono input, run/stop button that never moves. Terminal glass in both
 * themes, daisyUI tokens for borders and focus.
 */
.promptbar {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	background: #07090f;
	border: 1px solid #232842;
	border-radius: var(--radius-box);
	padding: 0.4rem 0.4rem 0.4rem 0.7rem;
}
.promptbar:focus-within {
	border-color: var(--color-primary);
}
.promptinput {
	flex: 1;
	min-width: 0;
	background: transparent;
	border: 0;
	outline: 0;
	color: #e8eaf0;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.9rem;
}
.promptinput::placeholder {
	color: #5b6486;
}
.promptgo {
	flex-shrink: 0;
}
.promptgo:disabled {
	opacity: 0.45;
}
.pane-hint {
	font-size: 0.8rem;
	opacity: 0.65;
	margin: 0;
}
.queue-head {
	margin: 0.25rem 0 0;
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	opacity: 0.6;
	display: flex;
	gap: 0.5rem;
	align-items: center;
}
.ttl {
	width: 7rem;
}
.queue {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
.gate {
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 0.6rem 0.7rem;
	background: color-mix(in oklab, var(--color-warning) 6%, transparent);
}
.gate-approved {
	background: color-mix(in oklab, var(--color-success) 8%, transparent);
	border-color: color-mix(in oklab, var(--color-success) 40%, var(--color-base-300));
}
.gate-denied,
.gate-expired {
	background: color-mix(in oklab, var(--color-error) 8%, transparent);
	border-color: color-mix(in oklab, var(--color-error) 40%, var(--color-base-300));
}
.gate-main {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	flex-wrap: wrap;
}
.gate-cmd {
	color: var(--color-warning);
	font-size: 0.85rem;
}
.gate-sub {
	font-size: 0.78rem;
	opacity: 0.65;
	margin-top: 0.25rem;
}
.gate-actions {
	display: flex;
	gap: 0.5rem;
	margin-top: 0.5rem;
}
.conn {
	font-size: 0.78rem;
	opacity: 0.6;
}
.conn.watch {
	color: var(--color-success);
	opacity: 1;
}
.screen {
	background: #07090f;
	color: #d7dbee;
	border: 1px solid #232842;
	border-radius: var(--radius-box);
	padding: 0.7rem;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 0.82rem;
	line-height: 1.45;
}
.line {
	white-space: pre-wrap;
	word-break: break-word;
}
.line + .line {
	margin-top: 0.35rem;
}
.prompt {
	color: #8ef0b2;
}
.output {
	color: #d7dbee;
	opacity: 0.9;
}
.screen-idle {
	opacity: 0.55;
	margin: 0;
}
.ps1 {
	color: var(--color-success);
	font-family: ui-monospace, Menlo, monospace;
}
.trace {
	border-top: 1px solid var(--color-base-300);
	padding-top: 0.5rem;
}
.trace summary {
	cursor: pointer;
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	opacity: 0.6;
	display: flex;
	gap: 0.5rem;
	align-items: center;
}
.trace .pane-hint {
	margin: 0.5rem 0;
}
.tracebody {
	background: #07090f;
	color: #9fe8bb;
	border: 1px solid #232842;
	border-radius: var(--radius-box);
	padding: 0.7rem;
	max-height: 10rem;
	overflow: auto;
	font-size: 0.78rem;
	white-space: pre-wrap;
	margin: 0;
}
.foot {
	font-size: 0.8rem;
	opacity: 0.6;
	margin-top: 1rem;
}
@keyframes pulse {
	50% {
		opacity: 0.35;
	}
}
@media (prefers-reduced-motion: reduce) {
	.transcript,
	.screen {
		scroll-behavior: auto;
	}
	.status-running {
		animation: none;
	}
	.bubble-row {
		animation: none;
	}
}
</style>
