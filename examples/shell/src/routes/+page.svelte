<script lang="ts">
import { tick } from 'svelte'
import { expectedBackendRevision, uiRevision } from 'virtual:shell-revision'
import { DraftStore, RunTracker, capabilityFailure, createMemorySink } from '@swelte/ai'
import { markToolsDoneRows, settleToolRow, upsertToolRow } from '#lib/shell.js'
import { applyTheme, setTheme, storedTheme, type Theme } from '#lib/theme.js'
import {
	activeAiConfig,
	createAiConfig,
	loadActiveAiConfigId,
	loadAiConfigs,
	saveActiveAiConfigId,
	saveAiConfigs,
	updateAiConfig,
	ADAPTER_MODELS,
	type AiAdapterKind,
	type AiConfiguration,
} from '#lib/ai-config.js'
import { onMount } from 'svelte'
import {
	ai_key_status,
	ai_models,
	chat,
	exec,
	send_input,
	shell_release,
	shell_revision,
	shell_tool_deny,
	shell_tool_resume,
	stream,
} from '#routes/+page.v'

// S7: backend revision identity for the read-only diagnostics surface.
// Recorded alongside the frontend bundle hash before any acceptance run.
let backendRev = $state('')
let bootId = $state('')
let revMismatch = $state(false)

import AiAnswer, { type AiThinkingStep, type AiToolCall } from '#lib/ai-answer.svelte'

interface ChatMsg {
	id: string
	role: 'user' | 'assistant'
	body: string
	author?: string
	meta?: string
	pending?: boolean
	thinking?: AiThinkingStep[]
	thinkingActive?: boolean
	thinkingStarted?: number
	tools?: AiToolCall[]
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
let deciding = $state(false)
let decisionGeneration = 0
let termLines: TermLine[] = $state([])
let messages: ChatMsg[] = $state([])
let approvals: PendingApproval[] = $state([])
// Per-turn terminal scope (spec §2 Stage B): checked → this chat turn
// Parked driving call for this turn (spec §2 Stage B): the SSE stream
// closes `waiting_approval`; the human decision resumes it via
// `shell_tool_resume` (approve) or drops it (deny).
let parkedDrive: { opId: string; tool: string; args: string; holder: string } | null = $state(null)
// hands off `shell:driver` to the AI before the text pass, so the
// driving tail may park `shell.exec`/`shell.send_input` for approval.
let driveScope = $state(false)
let streaming = $state(false)
let chatAbort: AbortController | null = null
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
const card = new DraftStore({ title: '', note: '' })
const sink = createMemorySink()
const tracker = new RunTracker()
const nextOp = () => `op-${Date.now().toString(36)}-${(opSeq += 1)}`
// AI configurations: adapter + model + run config, several to choose from
// in the chat window. Client-side only (localStorage, never API keys);
// the server reads keys from env (`.env`).
let aiConfigs: AiConfiguration[] = $state(loadAiConfigs())
let activeAiId: string | null = $state(loadActiveAiConfigId())
let keyedUp: { adapter: string; configured: boolean }[] = $state([])
let showAiSettings = $state(false)
let editingAiId: string | null = $state(null)
let aiFormName = $state('')
let aiFormAdapter: AiAdapterKind = $state('openrouter')
let aiFormModel = $state('')
let aiFormSystem = $state('')
let aiFormTemperature = $state('')
let aiFormMaxTokens = $state('')
// Live model catalog per adapter (fetched server-side, cached 10 min);
// falls back to ADAPTER_MODELS when unreachable/unkeyed.
let liveModels: Record<AiAdapterKind, string[]> = $state({
	deterministic: [],
	openrouter: [],
	openai: [],
	anthropic: [],
})
let liveModelsLoading = $state(false)

function modelSuggestions(adapter: AiAdapterKind): string[] {
	const live = liveModels[adapter]
	if (live.length) {
		// Keep the typed value first even when absent from the catalog.
		if (aiFormModel.trim() && !live.includes(aiFormModel.trim())) {
			return [aiFormModel.trim(), ...live]
		}
		return live
	}
	return ADAPTER_MODELS[adapter]
}

async function refreshLiveModels(adapter: AiAdapterKind) {
	if (adapter === 'deterministic') return
	if (liveModelsLoading || liveModels[adapter].length) return
	liveModelsLoading = true
	try {
		const ids = await ai_models({ adapter })
		if (Array.isArray(ids) && ids.length) {
			liveModels = { ...liveModels, [adapter]: ids }
		}
	} catch {
		// Offline/unkeyed/provider down — the datalist keeps the fallback.
	} finally {
		liveModelsLoading = false
	}
}

function persistAiConfigs() {
	saveAiConfigs(aiConfigs)
}

function selectAiConfig(id: string) {
	activeAiId = id
	saveActiveAiConfigId(id)
}

function configuredFor(adapter: AiAdapterKind): boolean {
	if (adapter === 'deterministic') return true
	return keyedUp.find((k) => k.adapter === adapter)?.configured ?? false
}

function startAiCreate() {
	editingAiId = null
	aiFormName = ''
	aiFormAdapter = 'openrouter'
	aiFormModel = ''
	aiFormSystem = ''
	aiFormTemperature = ''
	aiFormMaxTokens = ''
	showAiSettings = true
}

function startAiEdit(cfg: AiConfiguration) {
	editingAiId = cfg.id
	aiFormName = cfg.name
	aiFormAdapter = cfg.adapter
	aiFormModel = cfg.model
	aiFormSystem = cfg.run.system ?? ''
	aiFormTemperature = cfg.run.temperature !== undefined ? String(cfg.run.temperature) : ''
	aiFormMaxTokens = cfg.run.maxTokens !== undefined ? String(cfg.run.maxTokens) : ''
	showAiSettings = true
}

function saveAiForm() {
	const temperature = aiFormTemperature.trim() === '' ? undefined : Number(aiFormTemperature)
	const maxTokens = aiFormMaxTokens.trim() === '' ? undefined : Number(aiFormMaxTokens)
	if (temperature !== undefined && !Number.isFinite(temperature)) {
		note = 'temperature must be a number'
		return
	}
	if (maxTokens !== undefined && !(Number.isFinite(maxTokens) && maxTokens > 0)) {
		note = 'max tokens must be a positive number'
		return
	}
	const input = {
		name: aiFormName.trim() || `${aiFormAdapter} / ${aiFormModel.trim()}`,
		adapter: aiFormAdapter,
		model: aiFormModel.trim(),
		run: {
			...(temperature !== undefined ? { temperature } : {}),
			...(maxTokens !== undefined ? { maxTokens: Math.floor(maxTokens) } : {}),
			...(aiFormSystem.trim() ? { system: aiFormSystem.trim() } : {}),
		},
	}
	try {
		if (editingAiId) {
			const existing = aiConfigs.find((c) => c.id === editingAiId)
			if (!existing) return
			aiConfigs = aiConfigs.map((c) => (c.id === editingAiId ? updateAiConfig(c, input) : c))
		} else {
			const created = createAiConfig(input)
			aiConfigs = [...aiConfigs, created]
			selectAiConfig(created.id)
		}
		persistAiConfigs()
		showAiSettings = false
		editingAiId = null
		note = ''
	} catch (e) {
		showError(e)
	}
}

function deleteAiConfig(id: string) {
	if (aiConfigs.length <= 1) {
		note = 'keep at least one configuration'
		return
	}
	aiConfigs = aiConfigs.filter((c) => c.id !== id)
	if (activeAiId === id) {
		activeAiId = aiConfigs[0]?.id ?? null
		if (activeAiId) saveActiveAiConfigId(activeAiId)
	}
	persistAiConfigs()
	if (editingAiId === id) {
		editingAiId = null
		showAiSettings = false
	}
}

function showError(e: unknown) {
	note = e instanceof Error ? e.message : String(e)
}

// S7: compare the live backend revision against the recorded one. Called on
// mount (records the pair for this session) and before acceptance runs; a
// changed boot id after the same revision means a restart, a changed
// revision means a stale bundle check.
function checkRevision(seen: { backend_revision: string; boot_id: string }) {
 backendRev = seen.backend_revision
 bootId = seen.boot_id
 revMismatch = seen.backend_revision !== expectedBackendRevision
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

function paintExec(cmd: string, output: string, seq?: number) {
	// Single paint for one exec frame, optimistic or echoed — first call
	// wins, the twin is dropped. Commands and output always stay paired.
	const frame = seq ? `seq:${seq}` : `exec\n${cmd}\n${output}`
	if (seenFrames.has(frame)) return
	seenFrames.add(frame)
	lineSeq += 1
	termLines = [...termLines.slice(-199), { id: lineSeq, prompt: `$ ${cmd}`, body: output }]
	followTerm()
}

function pushLine(line: string) {
 let seq: number | undefined
 if (line.startsWith('frame\n')) {
  const end = line.indexOf('\n', 6)
  if (end < 0) return
  seq = Number(line.slice(6, end))
  line = line.slice(end + 1)
 }
	// Room protocol: `exec\n<cmd>\n<output>` or `chat\n<msg>`. The
	// terminal renders exec frames only — chat echoes stay in the chat
	// pane. Unframed (pre-v2) tails are dropped, never sniffed.
	const nl = line.indexOf('\n')
	const kind = nl < 0 ? '' : line.slice(0, nl)
	const rest = nl < 0 ? '' : line.slice(nl + 1)
	if (kind === 'chat' && rest === 'driver → human (human-input)' && (streaming || parkedDrive)) { interruptLocally(); return }
	if (kind !== 'exec' && kind !== 'stdin') return
	if (kind === 'stdin') {
		// Keystroke echo: someone's stdin, painted dim — never a command.
		paintStdin(rest, seq)
		return
	}
	const sep = rest.indexOf('\n')
	paintExec(sep < 0 ? rest : rest.slice(0, sep), sep < 0 ? '' : rest.slice(sep + 1), seq)
}

// Single paint for a stdin echo line — optimistic or echoed, first wins.
function paintStdin(keys: string, seq?: number) {
	const frame = seq ? `seq:${seq}` : `stdin\n${keys}`
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

// Merge one tool row into a message's tool session (append or update by id).
// Delegates to the pure `upsertToolRow` helper (shared with tests).
function upsertTool(id: string, tool: AiToolCall): AiToolCall[] {
	const msg = messages.find((m) => m.id === id)
	return upsertToolRow([...(msg?.tools ?? [])], tool as never) as never
}

// Settle only unsettled rows: completed work stays completed when a later
// model request fails or the user presses Stop. Successful calls remain
// successful (P3/S4); only active/pending rows flip on terminal outcome.
function markToolsDone(id: string, ok: boolean): AiToolCall[] {
	const msg = messages.find((m) => m.id === id)
	return markToolsDoneRows([...(msg?.tools ?? [])], ok) as never
}

// P3: settle one row at its actual completion event, by stable call ID —
// not at turn end. A success/failure event settles its row within one frame;
// completed receipts survive later Stop/errors (markToolsDone guards that).
function settleTool(msgId: string, callId: string, ok: boolean): AiToolCall[] {
	const msg = messages.find((m) => m.id === msgId)
	return settleToolRow([...(msg?.tools ?? [])], callId, ok) as never
}

async function runHumanCommand(raw: string) {
	const cmd = raw.trim()
	// Human commands run the real sandboxed shell: only an empty command
	// is rejected locally (terminal only, never the chat pane).
	if (!cmd || execRunning) return
	termKeys = ''
	execRunning = true
	try {
		const res = await exec({ cmd, op_id: nextOp(), caller: 'human' })
		paintExec(cmd, res.output, res.seq)
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
		const receipt = await send_input({ keys })
		paintStdin(keys, Number(receipt.split(':')[1]) || undefined)
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
async function sendChat(continuation = '') {
	const text = continuation ? 'Continuing after approved tool' : composer.trim()
	if (!text || streaming || (!continuation && parkedDrive)) return
	if (!continuation) composer = ''
	autoGrow()
	streaming = true
	status = 'running'
	note = ''
	// Pin the turn now: an interrupt mid-reply must attribute this exchange
	// to the turn it started on, not the one it settles on.
	const turn = activeTurn
	const controller = new AbortController()
	chatAbort = controller
	const cfg = activeAiConfig(aiConfigs, activeAiId)
	if (!continuation) {
		pushHistory(text)
		pushMsg('user', text, { meta: turn })
	}
	const waitId = pushMsg('assistant', '', {
		author: `${cfg.adapter} · ${cfg.model}`,
		meta: turn,
		pending: true,
		thinking: [{ label: 'Contacting provider', status: 'active' }],
		thinkingActive: true,
		thinkingStarted: Date.now(),
		tools: [],
	})
	let assembled = ''
	let gotTerminal = false
	try {
		// Streaming POST verb: engine events (text.delta, tool.progress,
		// approval.request … terminal) arrive incrementally over swelte_stream
		// SSE — the bubble grows per delta instead of wait-then-all. JSON
		// content-type would hit the RPC `fn` dispatch; urlencoded reaches
		// the verb arm. Non-2xx (missing key, bad model) throws before any
		// event via the verb error path.
		const form = new URLSearchParams({
			adapter: cfg.adapter,
			model: cfg.model,
			prompt: continuation ? text : messages.slice(-10).map(m => `${m.role}: ${m.body.slice(0, 2000)}`).join('\n'),
			temperature: String(cfg.run.temperature ?? -1),
			max_tokens: String(cfg.run.maxTokens ?? -1),
			system: cfg.run.system ?? '',
			drive: driveScope ? '1' : '0',
			continuation,
		})
		const res = await fetch('/?/ai_stream', {
			signal: controller.signal,
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/event-stream' },
			body: form.toString(),
		})
		if (!res.ok || !res.body) {
			let detail = `HTTP ${res.status}`
			try {
				const errBody = (await res.json()) as { error?: string }
				if (errBody?.error) detail = errBody.error
			} catch {
				/* keep the status */
			}
			throw new Error(detail)
		}
		const reader = res.body.getReader()
		const decoder = new TextDecoder()
		let buf = ''
		const seenSeq = new Set<number>()
		for (;;) {
			const { done, value } = await reader.read()
			if (controller.signal.aborted || turn !== activeTurn) { await reader.cancel(); return }
			buf += decoder.decode(value ?? new Uint8Array(), { stream: !done })
			let idx: number
			while ((idx = buf.indexOf('\n\n')) >= 0) {
				const block = buf.slice(0, idx)
				buf = buf.slice(idx + 2)
				let event: string | null = null
				const dataLines: string[] = []
				for (const line of block.split('\n')) {
					if (line.startsWith('event:')) event = line.slice(6).trim()
					else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
				}
				if (event === null) continue
				let parsed: {
					envelope?: { runId?: string; outputId?: string; seq?: number }
					payload?: {
						text?: string
						reason?: string
						error?: string
						tool?: string | { name?: string; decision?: string }
						callId?: string
						label?: string
						detail?: string
						step?: string
						op_id?: string
						args?: string
						holder?: string
					}
				}
				try {
					parsed = JSON.parse(dataLines.join('\n')) as typeof parsed
				} catch {
					continue
				}
				// Drop replays: interrupt retires the turn; late arrivals with
				// an already-seen seq never repaint.
				const seq = parsed.envelope?.seq
				if (seq !== undefined) {
					if (seenSeq.has(seq)) continue
					seenSeq.add(seq)
				}
				if (event === 'text.delta') {
					const delta = parsed.payload?.text ?? ''
					if (delta) {
						assembled += delta
						resolveMsg(waitId, { body: assembled, pending: true })
						followChat()
						verdict = ''
					}
				} else if (event === 'tool.progress') {
					// P3: rows track the execution lifecycle per call. A frame
					// with a tool name starts/updates its row `active`; the
					// label-only `Thinking` frame is model progress, never a
					// tool row (P0). Completion arrives via `shell.trace`
					// below — never at turn end.
					const p = parsed.payload ?? {}
					const progressTool = typeof p.tool === 'string' ? p.tool : p.tool?.name
					if (!progressTool) {
						resolveMsg(waitId, { thinking: [{ label: p.label ?? 'Thinking', status: 'active' }] })
						continue
					}
					const id = p.callId ?? progressTool ?? `tool-${seq ?? Date.now()}`
					resolveMsg(waitId, {
						thinking: [
							{ label: 'Contacting provider', status: 'done' },
							{ label: p.label ?? progressTool ?? 'Running tool', status: 'active' },
						],
						tools: upsertTool(waitId, {
							id,
							label: p.label ?? progressTool ?? 'tool call',
							chip: 'console',
							status: 'active',
							detail: [],
						}),
					})
					followChat()
				} else if (event === 'shell.trace') {
					// Execution-lifecycle channel, result-before-progress
					// safe: tool.start creates the row when the progress
					// frame has not arrived yet; tool.result settles the
					// same callId. Failed arrives typed, never sniffed.
					const p = parsed.payload as unknown as {
						event?: string
						call_id?: string
						reason?: string
						failed?: boolean
						label?: string
						tool?: string
						size?: number
					}
					if ((p.event === 'tool.start' || p.event === 'tool.result') && p.call_id) {
						resolveMsg(waitId, {
							thinking: [
								{ label: 'Contacting provider', status: 'done' },
								{ label: p.label ?? p.tool ?? 'Running tool', status: 'active' },
							],
							tools: upsertTool(waitId, {
								id: p.call_id,
								label: messages.find(m => m.id === waitId)?.tools?.find(t => t.id === p.call_id)?.label ?? p.label ?? p.tool ?? 'tool call',
								chip: 'console',
								status: 'active',
								detail: [],
							}),
						})
					}
					if (p.event === 'tool.result' && p.call_id) {
						resolveMsg(waitId, { tools: settleTool(waitId, p.call_id, !p.failed) })
						followChat()
					}
					// `tool.reused` needs no row change: the original row is
					// already done, and reuse creates no new row by design.
				} else if (event === 'approval.request') {
						// Parked driving call: mirror into the queue (clickable) + thread row.
						const ap = parsed.payload ?? {}
						const aname = typeof ap.tool === 'string' ? ap.tool : ap.tool?.name
						if (ap.op_id && aname && ap.args && ap.holder && !approvals.some((a) => a.opId === ap.op_id)) {
							parkedDrive = { opId: ap.op_id, tool: aname, args: ap.args, holder: ap.holder }
							approvals = [...approvals, { opId: ap.op_id, cmd: describeToolArgs(ap.args), status: 'pending', note: ap.label ?? 'Approval required' }]
						} else if (ap.op_id && aname && ap.args && ap.holder) {
							parkedDrive = { opId: ap.op_id, tool: aname, args: ap.args, holder: ap.holder }
						}
						resolveMsg(waitId, {
							tools: upsertTool(waitId, {
								id: ap.op_id ?? ap.callId ?? 0,
								label: ap.label ?? 'Approval requested',
								chip: 'approval',
								status: 'pending',
								detail: ap.detail ? [ap.detail] : [],
							}),
						})
						followChat()
				} else if (event === 'terminal') {
					gotTerminal = true
					const reason = parsed.payload?.reason ?? 'completed'
					tracker.finish(reason === 'completed' || reason === 'waiting_approval' ? 'completed' : 'failed', parsed.envelope?.seq ?? 0)
					resolveMsg(waitId, {
						body: assembled,
						pending: false,
						thinkingActive: false,
						tools: reason === 'waiting_approval' ? messages.find(m => m.id === waitId)?.tools : markToolsDone(waitId, reason === 'completed'),
					})
					if (reason !== 'completed' && reason !== 'waiting_approval') {
						throw new Error(parsed.payload?.error ?? `run ${reason}`)
					}
				}
				await tick()
			}
			if (done) break
		}
		if (!gotTerminal) throw new Error('stream ended without terminal')
		// Keep the shared-room echo (cross-client parity) but don't repaint
		// from it — the bubble already holds the assembled text.
		const echo = await chat({ msg: text })
		card.applyPatch({
			expectedRevision: card.current.revision,
			ops: [{ op: 'set', path: ['title'], value: text.slice(0, 40) }],
		})
		sink.record({
			runId: 'run-shell',
			turnId: turn,
			outputId: 'out-text',
			seq: echo.seq,
			kind: 'terminal',
			terminal: 'completed',
		})
		verdict = capabilityFailure({ input: ['video'], output: ['text'] }, [])
		status = 'done'
	} catch (e) {
		// P1: settle BOTH the message and its tool rows on abort/failure.
		// An aborted request must leave zero `active` rows: the bubble text
		// resolves AND every unsettled row flips failed.
		if (controller.signal.aborted) {
			resolveMsg(waitId, {
				body: assembled || 'Interrupted',
				pending: false,
				thinkingActive: false,
				tools: markToolsDone(waitId, false),
			})
			return
		}
		// Settle the transient bubble too — a failed turn must not hang
		// in its dimmed state; keep partial text when the stream died mid-run.
		resolveMsg(waitId, { body: assembled || 'send failed — try again', pending: false, thinkingActive: false, tools: markToolsDone(waitId, false) })
		showError(e)
		status = 'error'
	} finally {
		if (chatAbort === controller) { streaming = false; chatAbort = null }
	}
}

function interruptLocally() {
	decisionGeneration++
	deciding = false
	chatAbort?.abort()
	// Stop press while the AI drives: release the lease (backend flips to
	// `human`), drop any parked call, settle every active row on the live
	// bubble (P1: zero `active` rows may survive a Stop), and bump the turn
	// so late output rejects. Spec §3 preempt.
	if (parkedDrive) {
		approvals = approvals.map(a => a.opId === parkedDrive?.opId && a.status === 'pending' ? { ...a, status: 'denied', note: 'Interrupted by human' } : a)
	}
	// P1: settle active rows on EVERY open assistant bubble of this turn —
	// the stream catch settles the waitId bubble, but bubbles from earlier
	// requests in the same turn (or a bubble whose request already detached)
	// would otherwise keep `running` rows forever.
	for (const m of messages) {
		if (m.role === 'assistant' && m.meta === activeTurn) {
			resolveMsg(m.id, { tools: markToolsDone(m.id, false) })
		}
	}
	parkedDrive = null
	driveScope = false
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
	streaming = false
	chatAbort = null

}

async function interrupt() {
 interruptLocally()
 try { await shell_release({ holder: '' }) } catch { /* local UI has already settled */ }
}

function describeToolArgs(args: string): string {
 try {
  const value = JSON.parse(args) as { cmd?: string; url?: string; keys?: string }
  return value.cmd ?? value.url ?? value.keys ?? 'Console action'
 } catch { return 'Console action' }
}

async function decide(opId: string, allow: boolean) {
 const item = approvals.find(a => a.opId === opId)
 if (!item || item.status !== 'pending' || deciding || !parkedDrive || parkedDrive.opId !== opId) return
 const parked = parkedDrive
 const decisionTurn = activeTurn
 const generation = ++decisionGeneration
 deciding = true
 try {
  const args = { op_id: opId, holder: parked.holder, tool: parked.tool, args_json: parked.args }
  const res = allow ? await shell_tool_resume(args) : await shell_tool_deny(args)
  if (decisionTurn !== activeTurn || generation !== decisionGeneration) return
  messages = messages.map(m => ({ ...m, tools: m.tools?.map(t => t.id === opId ? { ...t, status: allow ? 'done' as const : 'failed' as const } : t) }))
  item.status = allow ? 'approved' : 'denied'
  item.note = allow ? 'Executed; continuing with the tool result' : 'Denied by human'
  approvals = [...approvals]
  parkedDrive = null
  if (allow && res.continuation) await sendChat(res.continuation)
 } catch (e) {
  // Keep the operation available for a lost-ack retry; never label a failed
  // dispatch as approved or silently execute it through the human RPC.
  item.note = e instanceof Error ? e.message : String(e)
  approvals = [...approvals]
  showError(e)
 } finally { if (generation === decisionGeneration) deciding = false }
}
// The single output path, started once on mount: subscribe to the backend
// room over SSE (scrollback tail first, then live lines). Every publish()
// from any RPC lands here exactly once — the RPC calls above paint
// optimistically with their seq, and those echoes are dropped in pushLine.
let watchingShell = true
async function watchShell() {
 while (watchingShell) {
  try {
   live = true
   for await (const line of stream({})) {
    if (!watchingShell) return
    if (line !== '__ping__') { pushLine(line); await tick() }
   }
  } catch { live = false }
  if (watchingShell) await new Promise(resolve => setTimeout(resolve, 500))
 }
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
	execRunning && termKeys.trim().length === 0
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
	aiConfigs = loadAiConfigs()
	activeAiId = loadActiveAiConfigId()
	void ai_key_status({ dummy: '' })
		.then((rows) => {
			keyedUp = rows.map((r) => ({ adapter: r.adapter, configured: r.configured }))
			// Prime the live catalog for the visible adapter so the combo-box
			// is populated when the user opens settings.
			const active = activeAiConfig(aiConfigs, activeAiId)
			void refreshLiveModels(active.adapter)
		})
		.catch(() => {
			keyedUp = []
		})
	live = true
	void watchShell()
	// S7: record the backend revision pair for this session; a changed boot
	// or revision on a later poll surfaces visibly instead of silently
	// retaining an apparently current backend.
	let disposed = false
	const refreshRevision = async () => {
		try { const seen = await shell_revision({ dummy: '' }); if (!disposed) checkRevision(seen) }
			catch { if (!disposed) revMismatch = true }
	}
	void refreshRevision()
	const revisionTimer = setInterval(refreshRevision, 1000)
	return () => { disposed = true; watchingShell = false; clearInterval(revisionTimer) }

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
			<div class="badge badge-outline gap-2" title="run status">
				<span class={`status-dot status-${status}`}></span>
				{status}
			</div>
			<div
				class="badge badge-outline gap-2"
				title={backendRev ? `backend ${backendRev} · boot ${bootId}` : 'backend revision unknown'}
				data-testid="revision"
				data-backend-rev={backendRev}
				data-ui-rev={uiRevision}
				data-expected-backend-rev={expectedBackendRevision}
				data-boot-id={bootId}
			>
				{backendRev ? `${backendRev.slice(0, 12)}${revMismatch ? ' · STALE' : ''}` : 'rev …'}
			</div>
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
				<span class="pane-model">{activeAiConfig(aiConfigs, activeAiId).name}</span>
			</div>
			<details class="ai-config">
				<summary class="ai-config-summary" title="AI configuration">
					<span aria-hidden="true" class="gear">&#9881;</span>
					<span class="ai-config-current">{activeAiConfig(aiConfigs, activeAiId).name}</span>
				</summary>
				<div class="ai-config-row">
				<label class="ai-config-label">
					<span>AI configuration</span>
					<select
						class="select select-bordered select-sm ai-config-select"
						value={activeAiConfig(aiConfigs, activeAiId).id}
						onchange={(e) => selectAiConfig(e.currentTarget.value)}
					>
						{#each aiConfigs as cfg (cfg.id)}
							<option value={cfg.id}>
								{cfg.name} ({cfg.adapter} · {cfg.model}{configuredFor(cfg.adapter)
									? ''
									: ' · key missing'})
							</option>
						{/each}
					</select>
				</label>
				<button class="btn btn-sm" onclick={() => (showAiSettings = !showAiSettings)}>
					{showAiSettings ? 'hide settings' : 'configure'}
				</button>
			</div>
			{#if activeAiConfig(aiConfigs, activeAiId).adapter !== 'deterministic' &&
				!configuredFor(activeAiConfig(aiConfigs, activeAiId).adapter)}
				<p class="pane-hint">
					server key missing — add
					{activeAiConfig(aiConfigs, activeAiId).adapter === 'openrouter'
						? 'OPENROUTER_API_KEY'
						: activeAiConfig(aiConfigs, activeAiId).adapter === 'openai'
							? 'OPENAI_API_KEY'
							: 'ANTHROPIC_API_KEY'}
					to <code>.env</code>, then restart
					<code>swelte dev</code>
				</p>
			{/if}
			{#if showAiSettings}
				{@const settingsCfg = activeAiConfig(aiConfigs, activeAiId)}
				<div class="ai-settings">
					<ul class="ai-list">
						{#each aiConfigs as cfg (cfg.id)}
							<li class:active={cfg.id === settingsCfg.id}>
								<span class="ai-name">{cfg.name}</span>
								<span class="ai-detail"
									>{cfg.adapter} · {cfg.model}{cfg.run.temperature !== undefined
										? ` · t=${cfg.run.temperature}`
										: ''}{cfg.run.maxTokens !== undefined
										? ` · max=${cfg.run.maxTokens}`
										: ''}{configuredFor(cfg.adapter) ? '' : ' · key missing'}</span
								>
								<span class="ai-row-actions">
									<button class="btn btn-xs" onclick={() => selectAiConfig(cfg.id)}>use</button>
									<button class="btn btn-xs" onclick={() => startAiEdit(cfg)}>edit</button>
									<button
										class="btn btn-xs"
										onclick={() => deleteAiConfig(cfg.id)}
										disabled={aiConfigs.length <= 1}
									>
										delete
									</button>
								</span>
							</li>
						{/each}
					</ul>
					<button class="btn btn-sm" onclick={startAiCreate}>new configuration</button>
					<div class="ai-form">
						<h3>{editingAiId ? 'edit configuration' : 'new configuration'}</h3>
						<label>
							name
							<input
								class="input input-bordered input-sm"
								bind:value={aiFormName}
								placeholder="OpenRouter fast"
							>
						</label>
						<label>
							adapter
							<select
								class="select select-bordered select-sm"
								bind:value={aiFormAdapter}
								onchange={() => void refreshLiveModels(aiFormAdapter)}
							>
								<option value="deterministic">deterministic (offline echo)</option>
								<option value="openrouter">openrouter (server key)</option>
								<option value="openai">openai (server key)</option>
								<option value="anthropic">anthropic (server key)</option>
							</select>
						</label>
						<label>
							model
							<input
								class="input input-bordered input-sm"
								bind:value={aiFormModel}
								list="ai-model-suggestions"
								placeholder={aiFormAdapter === 'deterministic'
									? 'deterministic-1'
									: aiFormAdapter === 'openrouter'
										? 'openai/gpt-4o-mini'
										: aiFormAdapter === 'openai'
											? 'gpt-4o-mini'
											: 'claude-3-5-haiku-latest'}
							>
							<datalist id="ai-model-suggestions">
								{#each modelSuggestions(aiFormAdapter) as m}
									<option value={m}></option>
								{/each}
							</datalist>
							{#if liveModelsLoading}
								<p class="pane-hint">loading live model list…</p>
							{/if}
						</label>
						<label>
							system prompt (optional)
							<textarea
								class="textarea textarea-bordered textarea-sm"
								bind:value={aiFormSystem}
								rows="2"
								placeholder="You are a shell assistant…"
							></textarea>
						</label>
						<div class="ai-form-row">
							<label>
								temperature (optional)
								<input
									class="input input-bordered input-sm"
									bind:value={aiFormTemperature}
									inputmode="decimal"
									placeholder="0.7"
								>
							</label>
							<label>
								max tokens (optional)
								<input
									class="input input-bordered input-sm"
									bind:value={aiFormMaxTokens}
									inputmode="numeric"
									placeholder="512"
								>
							</label>
						</div>
						<p class="pane-hint">
							API keys are never entered here — the server reads them from
							<code>.env</code> (OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY).
						</p>
						<div class="ai-form-actions">
							<button class="btn" onclick={saveAiForm}>save</button>
							<button
								class="btn"
								onclick={() => {
									showAiSettings = false
									editingAiId = null
								}}
							>
								cancel
							</button>
						</div>
					</div>
				</div>
			{/if}
			</details>
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
						<p>Ask or say hello — to get started.</p>
					</div>
				{/if}
				{#each messages as m (m.id)}
					<div class={`bubble-row ${m.role} ${m.pending ? 'is-pending' : ''}`}>
						<div class={`chat ${m.role === 'user' ? 'chat-end' : 'chat-start'}`}>
							<div class={`chat-bubble ${m.role === 'user' ? 'chat-bubble-primary' : ''}`}>
								{#if m.role === 'assistant'}
									<AiAnswer
										thinking={m.thinking ?? []}
										thinkingActive={m.thinkingActive ?? m.pending}
										thinkingDuration={m.thinkingStarted
											? Math.max(0, Math.round((Date.now() - m.thinkingStarted) / 1000))
											: 0}
										tools={m.tools ?? []}
										text={m.body}
										streaming={m.pending}
									/>
								{:else}
									{m.body}
								{/if}
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
				void sendChat()
			}}
			>
				{#if promptHistory.length}
					<details class="history">
						<summary class="history-btn" aria-label="Prompt history" title="Prompt history">↺</summary>
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
					placeholder="Prompt or tag a flavor with @"
					aria-label="chat message"
					rows="1"
				></textarea>
				{#if streaming || parkedDrive}
					<button class="sendbtn is-stop" type="button" onclick={interrupt} aria-label="Stop generating" title="Stop">
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>
					</button>
				{:else}
					<button
						class="sendbtn"
						type="submit"
						disabled={!composer.trim() || !!parkedDrive || deciding}
						aria-label="Send message"
						title="Send"
					>
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 3v9M3.5 8.5 8 3.5l4.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
					</button>
				{/if}
				<label class="drivetoggle" title="Let AI use shell and browse tools this turn">
					<input
						type="checkbox"
						bind:checked={driveScope}
						aria-label="Let AI use shell and browse tools this turn"
					>
					<span aria-hidden="true">⌨</span>
				</label>
			</form>
			{#if approvals.length}
				<h3 class="queue-head">
				approvals <span class="badge badge-warning badge-sm">{pending.length} pending</span>
			</h3>
			<details class="adv">
				<summary>how approvals work</summary>
				<p class="pane-hint">
					Approvals bind the exact action and expire with the 90 second terminal lease.
				</p>
			</details>
			<div class="queue" role="list" aria-label="approval queue">
				{#each approvals as a (a.opId)}
					<div class={`gate gate-${a.status}`} role="listitem">
						<div class="gate-main">
							<span class="badge badge-sm badge-ghost font-mono">tool action</span>
							<code class="gate-cmd">{a.cmd}</code>
							<span
								class={`badge badge-sm badge-${a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'error'}`}
								>{a.status}</span
							>
						</div>
						<div class="gate-sub" title={a.opId}>{a.note}</div>
						{#if a.status === 'pending'}
							<div class="gate-actions">
								<button class="btn btn-sm btn-primary" disabled={deciding || streaming} onclick={() => decide(a.opId, true)}>
									approve + run once
								</button>
								<button class="btn btn-sm btn-ghost" disabled={deciding || streaming} onclick={() => decide(a.opId, false)}>
									deny
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			{/if}
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
				<input
					class="promptinput"
					bind:value={termKeys}
					placeholder={execRunning ? 'type stdin for the running command…' : 'ls, cd src, cat <file>'}
					aria-label={execRunning ? 'stdin for the running command' : 'terminal command'}
				>
				<button
					class="promptgo"
					type="submit"
					disabled={submitDisabled}
					aria-label={execRunning ? 'send keystroke to stdin' : 'run command'}
					title={execRunning ? 'Send keystroke' : 'Run'}
				>
					{#if execRunning}
						<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" /></svg>
					{:else}
						<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v9M3.5 8.5 8 3.5l4.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
					{/if}
				</button>
			</form>
		</section>
	</section>
	{#if note}
		<div class="alert alert-error mt-4"><span>{note}</span></div>
	{/if}
	<details class="devdrawer">
		<summary>developer <span class="badge badge-sm badge-ghost">{sink.events.length}</span></summary>
		<div class="devgrid">
			<p class="pane-hint">turn {activeTurn}</p>
			{#if verdict}
				<p class="pane-hint">capability probe: {verdict}</p>
			{/if}
			<label class="pane-hint devfilter"
				>trace filter
				<input
					class="input input-bordered input-xs"
					bind:value={traceFilter}
					placeholder="turn-1"
				></label
			>
			<pre class="devtrace">{traceShown.length
	? traceShown
		.map((e) => `${e.runId} ${e.turnId ?? '-'} ${e.outputId} #${e.seq} ${e.kind}`)
		.join('\n')
	: '(no events yet)'}</pre>
		</div>
	</details>
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
.pane-model {
	font-size: 0.72rem;
	opacity: 0.55;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 16rem;
}
/* AI configuration picker + editor: collapsed gear popover, not inline. */
.ai-config {
	position: relative;
}
.ai-config-summary {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	list-style: none;
	cursor: pointer;
	font-size: 0.78rem;
	color: var(--color-base-content);
	opacity: 0.6;
	padding: 0.15rem 0.35rem;
	border-radius: 0.4rem;
}
.ai-config-summary:hover {
	opacity: 1;
	background: var(--color-base-200);
}
.ai-config-summary::-webkit-details-marker {
	display: none;
}
.ai-config-summary .gear {
	font-size: 0.85rem;
	line-height: 1;
}
.ai-config-current {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 14rem;
}
.ai-config-row {
	position: absolute;
	top: calc(100% + 0.35rem);
	left: 0;
	z-index: 20;
	min-width: 16rem;
	display: flex;
	gap: 0.5rem;
	align-items: flex-end;
	justify-content: space-between;
	flex-wrap: wrap;
	background: var(--color-base-100);
	color: var(--color-base-content);
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 0.6rem 0.7rem;
	box-shadow: var(--shadow-md, 0 4px 12px rgb(0 0 0 / 0.15));
}
.ai-config-label {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.78rem;
	opacity: 0.9;
	flex: 1;
	min-width: 12rem;
}
.ai-config-label > span {
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	opacity: 0.65;
}
.ai-config-select {
	width: 100%;
}
.ai-settings {
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 0.7rem;
	display: flex;
	flex-direction: column;
	gap: 0.7rem;
	background: color-mix(in oklab, var(--color-base-200) 40%, transparent);
}
.ai-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}
.ai-list li {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	flex-wrap: wrap;
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 0.4rem 0.5rem;
}
.ai-list li.active {
	border-color: var(--color-primary);
}
.ai-name {
	font-weight: 600;
}
.ai-detail {
	font-size: 0.78rem;
	opacity: 0.7;
	flex: 1;
	min-width: 10rem;
}
.ai-row-actions {
	display: flex;
	gap: 0.35rem;
}
.ai-form {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
.ai-form h3 {
	margin: 0;
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	opacity: 0.65;
}
.ai-form label {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.8rem;
}
.ai-form-row {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.5rem;
}
.ai-form-actions {
	display: flex;
	gap: 0.5rem;
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
/* Assistant bubbles: default daisyUI is base-300 with inherited ink —
 * unreadable on dark. Pin an explicit themed surface + ink both ways. */
.bubble-row .chat-start .chat-bubble:not(.chat-bubble-primary) {
	background: var(--color-base-200);
	color: var(--color-base-content);
	border: 1px solid var(--color-base-300);
}
.bubble-row .chat-end .chat-bubble-primary {
	color: var(--color-primary-content);
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
/* Chat composer: input left, circular send right. Mirrors the target:
 * short placeholder, icon-only send/stop, history + terminal-scope as
 * quiet icon affordances. Card surface, daisyUI borders — readable in
 * both themes via base-content tokens. */
.composerbar {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	background: transparent;
	border: 0;
	padding: 0;
	color: var(--color-base-content);
}
.composerinput {
	flex: 1;
	min-width: 0;
	background: var(--color-base-100);
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 0.55rem 0.8rem;
	outline: 0;
	resize: none;
	color: inherit;
	font-size: 0.9rem;
	line-height: 1.4;
	max-height: none;
}
.composerinput:focus {
	border-color: var(--color-primary);
}
.composerinput::placeholder {
	color: var(--color-base-content);
	opacity: 0.45;
}
/* Round icon send/stop — arrow only, no text (cf. target screenshot). */
.sendbtn {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	border-radius: 999px;
	border: 1px solid var(--color-base-300);
	background: var(--color-base-100);
	color: var(--color-base-content);
	cursor: pointer;
}
.sendbtn:hover:not(:disabled) {
	border-color: var(--color-primary);
	color: var(--color-primary);
}
.sendbtn:disabled {
	opacity: 0.35;
	cursor: default;
}
.sendbtn.is-stop {
	background: var(--color-warning);
	border-color: var(--color-warning);
	color: var(--color-warning-content, #1a1a1a);
}
/* History + terminal-scope as quiet icon buttons, not talkative pills. */
.history {
	position: relative;
	flex-shrink: 0;
}
.history-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 999px;
	list-style: none;
	cursor: pointer;
	color: var(--color-base-content);
	opacity: 0.55;
	font-size: 0.9rem;
}
.history-btn:hover {
	opacity: 1;
	background: var(--color-base-200);
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
	color: var(--color-base-content);
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
.drivetoggle {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 999px;
	cursor: pointer;
	color: var(--color-base-content);
	opacity: 0.55;
	position: relative;
}
.drivetoggle:hover {
	opacity: 1;
	background: var(--color-base-200);
}
.drivetoggle:has(input:checked) {
	opacity: 1;
	background: var(--color-warning);
	color: var(--color-warning-content, #1a1a1a);
}
.drivetoggle input {
	position: absolute;
	opacity: 0;
	pointer-events: none;
}
.drivetoggle span {
	font-size: 0.9rem;
	line-height: 1;
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
/* Terminal prompt: boxed input + detached round icon send (mirrors chat). */
.promptbar {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	background: transparent;
	border: 0;
	padding: 0;
	color: var(--color-base-content);
}
.promptbar:focus-within .promptinput {
	border-color: var(--color-primary);
}
.promptinput {
	flex: 1;
	min-width: 0;
	background: var(--color-base-100);
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 0.55rem 0.8rem;
	outline: 0;
	color: inherit;
	font:
		0.9rem / 1.4 var(--font-mono, ui-monospace, monospace);
}
.promptinput::placeholder {
	color: var(--color-base-content);
	opacity: 0.45;
}
.promptgo {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	border-radius: 999px;
	border: 1px solid var(--color-base-300);
	background: var(--color-base-100);
	color: var(--color-base-content);
	cursor: pointer;
}
.promptgo:hover:not(:disabled) {
	border-color: var(--color-primary);
	color: var(--color-primary);
}
.promptgo:disabled {
	opacity: 0.35;
	cursor: default;
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
/* Terminal screen: themed surface, not a hardcoded dark glass — the old
 * #07090f + #232842 pair was unreadable in light mode and invisible in dark.
 * Prompt lines stay green-tinted via the success token. */
.screen {
	background: var(--color-base-200);
	color: var(--color-base-content);
	border: 1px solid var(--color-base-300);
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
	color: var(--color-success-strong, var(--color-success));
}
.output {
	color: inherit;
	opacity: 0.9;
}
.screen-idle {
	opacity: 0.55;
	margin: 0;
}
/* Collapsed how-it-works + dev drawer. The trace/error/console styles below
 * stay token-driven; no hardcoded glass. */
.adv {
	border-top: 1px solid var(--color-base-300);
	padding-top: 0.4rem;
	margin-top: 0.5rem;
}
.adv summary {
	cursor: pointer;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	opacity: 0.55;
}
.devdrawer {
	margin-top: 1rem;
	border-top: 1px solid var(--color-base-300);
	padding-top: 0.5rem;
}
.devdrawer summary {
	cursor: pointer;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	opacity: 0.55;
	display: flex;
	gap: 0.5rem;
	align-items: center;
}
.devgrid {
	display: grid;
	gap: 0.5rem;
	margin-top: 0.5rem;
}
.devfilter {
	display: grid;
	gap: 0.25rem;
}
.devtrace {
	background: var(--color-base-200);
	color: var(--color-base-content);
	border: 1px solid var(--color-base-300);
	border-radius: var(--radius-box);
	padding: 0.7rem;
	max-height: 10rem;
	overflow: auto;
	font-size: 0.78rem;
	white-space: pre-wrap;
	margin: 0;
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
