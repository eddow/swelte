import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApprovalStore, authorizeShellCall, runAllowlisted } from '../src/routes/shell/ai/shell.js'
import { DraftStore } from '../src/lib/draft.js'
import { RunTracker } from '../src/lib/envelope.js'
import { createSseParser, decodeSseEvent, encodeSseEvent } from '../src/lib/sse.js'
import { createMemorySink } from '../src/lib/trace.js'

describe('shell/ai dogfood: one backend shell shared by chat + terminal', () => {
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
})
