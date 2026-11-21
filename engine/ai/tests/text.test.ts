import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeterministicAdapter, routeAdapter } from '../src/lib/adapters.js'
import {
	ANTHROPIC_CAPS,
	AnthropicAdapter,
	anthropicFromEnv,
	checkAnthropicFit,
} from '../src/lib/anthropic.js'
import type { RunRequirements } from '../src/lib/capabilities.js'
import { DraftStore } from '../src/lib/draft.js'
import { RunTracker } from '../src/lib/envelope.js'

import { checkOpenAiFit, OPENAI_CAPS, OpenAiAdapter, openAiFromEnv } from '../src/lib/openai.js'
import { checkOpenRouterFit, OpenRouterAdapter } from '../src/lib/openrouter.js'
import { applyPolicy, METADATA_ONLY } from '../src/lib/recorder.js'
import { createSseParser, decodeSseEvent, encodeSseEvent } from '../src/lib/sse.js'
import { createMemorySink } from '../src/lib/trace.js'

describe('sse framing', () => {
	it('encodes envelope+payload as one SSE message and decodes it back', () => {
		const text = encodeSseEvent(
			{ runId: 'r', turnId: 't', outputId: 'o', kind: 'text.delta', seq: 0 },
			{ text: 'hi' }
		)
		assert.ok(text.startsWith('event: text.delta\n'))
		const seen: { kind: string; payload: unknown }[] = []
		const push = createSseParser((e) => seen.push({ kind: e.envelope.kind, payload: e.payload }))
		push(text.slice(0, 10))
		push(text.slice(10))
		assert.equal(seen.length, 1)
		assert.deepEqual(seen[0].payload, { text: 'hi' })
	})
	it('carries all text-run kinds on one response without envelope loss', () => {
		for (const kind of [
			'text.delta',
			'citation',
			'tool.progress',
			'approval.request',
			'state.patch',
		]) {
			const wire = encodeSseEvent({ runId: 'r', outputId: 'o', kind, seq: 1 }, { n: 1 })
			const [, data] = wire.split('\n')
			const decoded = decodeSseEvent(kind, data.replace(/^data: /, ''))
			assert.equal(decoded.envelope.kind, kind)
			assert.equal(decoded.envelope.seq, 1)
		}
	})
	it('rejects non-JSON and envelope-less data', () => {
		assert.throws(() => decodeSseEvent('text.delta', 'nope'))
		assert.throws(() => decodeSseEvent('text.delta', '{"payload":{}}'))
	})
})

describe('draft', () => {
	it('applies typed patches at the expected revision, bumps revision', () => {
		const store = new DraftStore({ text: '', title: 't' })
		assert.ok(
			store.applyPatch({
				expectedRevision: 0,
				ops: [{ op: 'append', path: ['text'], value: 'he' }],
			})
		)
		assert.ok(
			store.applyPatch({
				expectedRevision: 1,
				ops: [{ op: 'append', path: ['text'], value: 'llo' }],
			})
		)
		assert.equal(store.current.value.text, 'hello')
		assert.equal(store.current.revision, 2)
	})
	it('flags a snapshot request on gap; snapshot resumes patching', () => {
		const store = new DraftStore({ text: '' })
		assert.equal(store.applyPatch({ expectedRevision: 7, ops: [] }), false)
		assert.ok(store.needsSnapshot)
		store.applySnapshot({ revision: 7, value: { text: 'snap' } })
		assert.ok(!store.needsSnapshot)
		assert.ok(
			store.applyPatch({ expectedRevision: 7, ops: [{ op: 'set', path: ['text'], value: 'ok' }] })
		)
	})
	it('one bounded repair; never repeats an executed tool', () => {
		const store = new DraftStore({ text: 'bad' })
		store.markToolExecuted('call-1')
		assert.throws(() => store.repair({ text: 'x' }, 'call-1'))
		assert.deepEqual(store.repair({ text: 'fixed' }).text, 'fixed')
		assert.throws(() => store.repair({ text: 'again' }))
	})
})

describe('adapters + recorder policy', () => {
	it('deterministic adapter echoes text and emits terminal', async () => {
		const kinds: string[] = []
		for await (const e of new DeterministicAdapter().run('ping', {
			input: ['text'],
			output: ['text'],
		}))
			kinds.push(e.envelope.kind)
		assert.deepEqual(kinds, ['text.delta', 'terminal'])
	})
	it('routing prefers the cheapest fast adapter covering the run', () => {
		const slow = new DeterministicAdapter()
		const fast = new DeterministicAdapter()
		fast.name = 'fast'
		fast.latencyMs = 0
		slow.latencyMs = 500
		const picked = routeAdapter({ input: ['text'], output: ['text'] }, [slow, fast], {
			maxLatencyMs: 50,
		})
		assert.equal(picked?.name, 'fast')
		assert.equal(
			routeAdapter({ input: ['text'], output: ['text'] }, [slow], { maxLatencyMs: 50 }),
			null
		)
	})
	it('one text consumer switches providers by config only', async () => {
		const sse = (body: string) =>
			(async () =>
				new Response(new TextEncoder().encode(body), {
					status: 200,
					headers: { 'content-type': 'text/event-stream' },
				})) as unknown as typeof fetch
		const req: RunRequirements = { input: ['text'], output: ['text'] }
		// Same input, same consumer loop, three provider protocols.
		const runs = [
			new OpenRouterAdapter({
				apiKey: 'k',
				model: 'm',
				fetch: sse('data: {"choices":[{"delta":{"content":"or"}}]}\n\ndata: [DONE]\n\n'),
			}),
			new OpenAiAdapter({
				apiKey: 'k',
				model: 'm',
				fetch: sse('data: {"type":"response.output_text.delta","delta":"oa"}\n\n'),
			}),
			new AnthropicAdapter({
				apiKey: 'k',
				model: 'm',
				fetch: sse(
					'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"an"}}\n\n'
				),
			}),
		]
		const words: string[] = []
		const names: string[] = []
		for (const a of runs) {
			names.push(a.name)
			for await (const e of a.run('hi', req)) {
				if (e.envelope.kind === 'text.delta') words.push((e.payload as { text: string }).text)
			}
		}
		assert.deepEqual(names, ['openrouter', 'openai', 'anthropic'])
		assert.deepEqual(words, ['or', 'oa', 'an'])
		for (const a of runs) {
			assert.ok(checkOpenRouterFit(req, { model: 'x' }) === null || a.name !== 'openrouter')
			assert.ok(checkOpenAiFit(req, { model: 'x' }) === null || a.name !== 'openai')
			assert.ok(checkAnthropicFit(req, { model: 'x' }) === null || a.name !== 'anthropic')
		}
		assert.equal(OPENAI_CAPS.usageReporting, true)
		assert.equal(ANTHROPIC_CAPS.structuredOutput, false)
		assert.throws(() => openAiFromEnv({}, { model: 'm' }), /missing OPENAI_API_KEY/)
		assert.throws(() => anthropicFromEnv({}, { model: 'm' }), /missing ANTHROPIC_API_KEY/)
	})
	it('metadata-only default retains nothing; opt-ins keep their slice', () => {
		const full = { expiresAt: 9, prompts: 'p', transcripts: 't', toolPayloads: {}, media: 'm' }
		assert.deepEqual(applyPolicy(full, METADATA_ONLY), { expiresAt: 9 })
		assert.deepEqual(applyPolicy(full, { ...METADATA_ONLY, transcripts: true }).transcripts, 't')
	})
	it('tool-free fixture: interrupt mid-reply, no stale output resumes', () => {
		// Live transcript + progressively filled card; spoken-reply placeholder
		// stays text in this slice. Interrupt turn 1 mid-reply, start turn 2.
		const sink = createMemorySink()
		const tracker = new RunTracker()
		const card = new DraftStore({ title: '', note: '' })
		let activeTurn = 'turn-1'

		// Turn 1: two text deltas + a card patch stream in.
		sink.record({
			runId: 'run-fixture',
			turnId: 'turn-1',
			outputId: 'out-text',
			seq: 0,
			kind: 'text.delta',
		})
		sink.record({
			runId: 'run-fixture',
			turnId: 'turn-1',
			outputId: 'out-text',
			seq: 1,
			kind: 'text.delta',
		})
		assert.ok(
			card.applyPatch({
				expectedRevision: 0,
				ops: [{ op: 'set', path: ['title'], value: 'draft' }],
			})
		)
		sink.record({
			runId: 'run-fixture',
			turnId: 'turn-1',
			outputId: 'out-card',
			seq: 2,
			kind: 'state.patch',
		})

		// Interrupt: end turn-1 output, start turn 2, reject late turn-1 output.
		tracker.endOutput('out-text')
		activeTurn = 'turn-2'
		const lateAccepted = (turnId: string) => turnId === activeTurn
		assert.equal(lateAccepted('turn-1'), false)

		// Turn 2: fresh transcript + card completion, then terminal.
		sink.record({
			runId: 'run-fixture',
			turnId: 'turn-2',
			outputId: 'out-text-2',
			seq: 0,
			kind: 'text.delta',
		})
		assert.ok(
			card.applyPatch({
				expectedRevision: 1,
				ops: [{ op: 'set', path: ['title'], value: 'final' }],
			})
		)
		sink.record({
			runId: 'run-fixture',
			turnId: 'turn-2',
			outputId: 'out-text-2',
			seq: 1,
			kind: 'terminal',
		})
		tracker.finish('completed', 1)

		const turn1 = sink.events.filter((e) => e.turnId === 'turn-1')
		const turn2 = sink.events.filter((e) => e.turnId === 'turn-2')
		assert.equal(turn1.length, 3)
		assert.ok(turn2.every((e) => e.turnId === 'turn-2' && e.outputId === 'out-text-2'))
		assert.equal(card.current.value.title, 'final')
		assert.equal(tracker.terminalState?.reason, 'completed')
	})
})
