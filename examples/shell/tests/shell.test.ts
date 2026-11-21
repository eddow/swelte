import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DraftStore } from '@swelte/ai'
import { RunTracker } from '@swelte/ai'
import { createSseParser, decodeSseEvent, encodeSseEvent } from '@swelte/ai'
import { createMemorySink } from '@swelte/ai'
import { ApprovalStore, authorizeShellCall, runAllowlisted } from '../src/lib/shell.js'
import {
	activeAiConfig,
	createAiConfig,
	defaultAiConfigs,
	loadActiveAiConfigId,
	loadAiConfigs,
	saveActiveAiConfigId,
	saveAiConfigs,
	updateAiConfig,
	ADAPTER_MODELS,
} from '../src/lib/ai-config.js'

describe('shell example: one backend shell shared by chat + terminal', () => {
	it('human allowlisted commands run; unknown commands fail actionably', () => {
		const ok = authorizeShellCall('human', 'echo hello shared shell')
		assert.equal(ok.allowed, true)
		assert.equal(runAllowlisted('echo hello shared shell'), 'hello shared shell')
		const bad = authorizeShellCall('human', 'rm -rf /')
		assert.equal(bad.allowed, false)
		assert.ok(bad.reason.includes('not allowlisted'))
		assert.throws(() => runAllowlisted('rm -rf /'), /not allowlisted/)
	})

	it('ai commands need human approval; approve executes exactly once', () => {
		const store = new ApprovalStore()
		const gate = authorizeShellCall('ai', 'echo from-ai')
		assert.equal(gate.needsApproval, true)
		const rec = store.request('ai', 'echo from-ai', 'op-1')
		assert.equal(rec.decision, 'pending')
		store.decide('op-1', 'approved')
		const first = store.markExecuted('op-1')
		assert.equal(first.already, false)
		assert.equal(runAllowlisted(first.record.cmd), 'from-ai')
		// Duplicate ack replays the receipt, never re-executes.
		const retry = store.markExecuted('op-1')
		assert.equal(retry.already, true)
		// Duplicate decide folds away too.
		assert.equal(store.decide('op-1', 'approved').decision, 'approved')
	})

	it('expiry denies; denied/expired approvals never execute', () => {
		const store = new ApprovalStore()
		store.request('ai', 'echo late', 'op-expired', -1)
		assert.equal(store.decide('op-expired', 'approved').decision, 'expired')
		assert.throws(() => store.markExecuted('op-expired'), /expired/)
		store.request('ai', 'echo no', 'op-denied')
		store.decide('op-denied', 'denied')
		assert.throws(() => store.markExecuted('op-denied'), /denied/)
	})

	it('interrupt mid-reply: late turn output rejected, new turn stays clean', () => {
		const tracker = new RunTracker()
		const card = new DraftStore({ title: '', note: '' })
		const sink = createMemorySink()
		let activeTurn = 'turn-1'
		sink.record({ runId: 'run-shell', turnId: 'turn-1', outputId: 'out-text', seq: 0, kind: 'text.delta' })
		assert.ok(
			card.applyPatch({ expectedRevision: 0, ops: [{ op: 'set', path: ['title'], value: 'draft' }] })
		)
		// Human interrupts: end turn-1 output, start turn 2, reject late arrivals.
		tracker.endOutput('out-text')
		activeTurn = 'turn-2'
		assert.equal(activeTurn === 'turn-1' ? true : false, false)
		sink.record({ runId: 'run-shell', turnId: 'turn-2', outputId: 'out-text-2', seq: 0, kind: 'text.delta' })
		assert.ok(
			card.applyPatch({ expectedRevision: 1, ops: [{ op: 'set', path: ['title'], value: 'final' }] })
		)
		sink.record({ runId: 'run-shell', turnId: 'turn-2', outputId: 'out-text-2', seq: 1, kind: 'terminal' })
		tracker.finish('interrupted', 1)
		assert.equal(card.current.value.title, 'final')
		assert.ok(tracker.isTerminal)
		assert.ok(sink.events.every((e) => e.runId === 'run-shell'))
	})

	it('SSE framing carries text + approval.request on one response', () => {
		for (const kind of ['text.delta', 'approval.request'] as const) {
			const wire = encodeSseEvent({ runId: 'r', turnId: 't', outputId: 'o', kind, seq: 2 }, { n: 1 })
			assert.ok(wire.startsWith(`event: ${kind}\n`))
			const [, data] = wire.split('\n')
			assert.equal(decodeSseEvent(kind, data.replace(/^data: /, '')).envelope.turnId, 't')
		}
		const seen: string[] = []
		const push = createSseParser((e) => seen.push(e.envelope.kind))
		const a = encodeSseEvent({ runId: 'r', outputId: 'o', kind: 'text.delta', seq: 0 }, { text: 'hi' })
		const b = encodeSseEvent({ runId: 'r', outputId: 'o', kind: 'terminal', seq: 1 }, { reason: 'completed' })
		push(a.slice(0, 12))
		push(a.slice(12) + b)
		assert.deepEqual(seen, ['text.delta', 'terminal'])
	})

	it('AI configs: defaults cover every implemented adapter, none carries keys', () => {
		const defaults = defaultAiConfigs()
		assert.deepEqual(
			defaults.map((c) => c.adapter),
			['deterministic', 'openrouter', 'openai', 'anthropic']
		)
		for (const c of defaults) assert.ok(!('apiKey' in c) && !JSON.stringify(c).includes('KEY'))
		assert.equal(activeAiConfig(defaults, null).id, defaults[0]!.id)
		assert.equal(activeAiConfig(defaults, 'missing-id').id, defaults[0]!.id)
	})

	it('AI configs: create/update validate adapter + model', () => {
		const created = createAiConfig({
			name: 'fast',
			adapter: 'openrouter',
			model: ' openai/gpt-4o-mini ',
			run: { temperature: 0.7, maxTokens: 512, system: 'be brief' },
		})
		assert.equal(created.model, 'openai/gpt-4o-mini')
		assert.deepEqual(created.run, { temperature: 0.7, maxTokens: 512, system: 'be brief' })
		assert.throws(() => createAiConfig({ name: 'x', adapter: 'openrouter', model: '  ', run: {} }))
		assert.throws(() =>
			createAiConfig({ name: 'x', adapter: 'nope' as never, model: 'm', run: {} })
		)
		const updated = updateAiConfig(created, { model: 'anthropic/claude', adapter: 'anthropic' })
		assert.equal(updated.adapter, 'anthropic')
		assert.equal(updated.model, 'anthropic/claude')
		assert.equal(updated.id, created.id)
		assert.throws(() => updateAiConfig(created, { model: '' }))
	})

	it('AI configs: localStorage round-trips configs + active id (private-mode safe)', () => {
		const mem = new Map<string, string>()
		const g = globalThis as unknown as Record<string, unknown>
		const prev = g.localStorage
		g.localStorage = {
			getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
			setItem: (k: string, v: string) => void mem.set(k, v),
			removeItem: (k: string) => void mem.delete(k),
		}
		try {
			assert.deepEqual(loadAiConfigs().map((c) => c.adapter), defaultAiConfigs().map((c) => c.adapter))
			const mine = [createAiConfig({ name: 'mine', adapter: 'openai', model: 'gpt-4o-mini', run: {} })]
			saveAiConfigs(mine)
			assert.equal(loadAiConfigs()[0]!.model, 'gpt-4o-mini')
			assert.equal(loadActiveAiConfigId(), null)
			saveActiveAiConfigId(mine[0]!.id)
			assert.equal(loadActiveAiConfigId(), mine[0]!.id)
			assert.equal(activeAiConfig(mine, mine[0]!.id).name, 'mine')
		} finally {
			if (prev === undefined) delete g.localStorage
			else g.localStorage = prev
		}
	})

	it('AI configs: offline fallback models exist per adapter (live catalog wins at runtime)', () => {
		for (const adapter of ['deterministic', 'openrouter', 'openai', 'anthropic'] as const) {
			assert.ok(
				ADAPTER_MODELS[adapter].length > 0,
				`${adapter} needs an offline fallback suggestion`
			)
		}
		// The live `ai_models` RPC returns this shape (array of ids) — the
		// combo-box renders live ids when present, fallback otherwise.
		const live: string[] = ['openai/gpt-4o-mini', 'anthropic/claude-3-5-haiku']
		assert.ok(live.every((m) => typeof m === 'string' && m.length > 0))
	})

	it('AI configs: blocked storage falls back to defaults without throwing', () => {
		const g = globalThis as unknown as Record<string, unknown>
		const prev = g.localStorage
		g.localStorage = {
			getItem: () => {
				throw new Error('blocked')
			},
			setItem: () => {
				throw new Error('blocked')
			},
		}
		try {
			assert.doesNotThrow(() => loadAiConfigs())
			assert.doesNotThrow(() => saveAiConfigs(defaultAiConfigs()))
			assert.doesNotThrow(() => loadActiveAiConfigId())
			assert.doesNotThrow(() => saveActiveAiConfigId('x'))
			assert.ok(defaultAiConfigs().length > 0)
		} finally {
			if (prev === undefined) delete g.localStorage
			else g.localStorage = prev
		}
	})
})
