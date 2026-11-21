import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdapterSelection } from '../src/lib/capabilities.js'
import { capabilityFailure, selectAdapter } from '../src/lib/capabilities.js'
import { isAppKind, isBuiltinKind, isKnownKind, RunTracker, validateEnvelope } from '../src/lib/envelope.js'
import { generateSchema } from '../src/lib/schema.js'
import { createMemorySink } from '../src/lib/trace.js'

const textOnly: AdapterSelection = {
	name: 'text',
	model: 'text-1',
	caps: {
		input: { modalities: ['text'], encodings: ['utf-8'], duplex: true },
		output: { modalities: ['text'], encodings: ['utf-8'], duplex: true },
		structuredOutput: true,
		toolCalls: false,
		usageReporting: true,
		cancellation: true,
	},
}

const video: AdapterSelection = {
	name: 'video',
	model: 'video-1',
	caps: {
		input: { modalities: ['text', 'image'], encodings: ['utf-8', 'png'], duplex: true },
		output: { modalities: ['text', 'audio'], encodings: ['utf-8', 'pcm16'], duplex: true },
		structuredOutput: true,
		toolCalls: false,
		usageReporting: false,
		cancellation: true,
	},
}

describe('envelope', () => {
	it('builtin kinds are known; namespaced app kinds are known', () => {
		assert.ok(isBuiltinKind('text.delta'))
		assert.ok(isAppKind('app:note/1'))
		assert.ok(isKnownKind('app:note/1'))
		assert.ok(!isKnownKind('media/audio-chunk'))
		assert.ok(!isKnownKind('whatever'))
	})
	it('validateEnvelope rejects blanks and unknown kinds', () => {
		assert.ok(validateEnvelope({ runId: '', outputId: '', kind: '', seq: -1 }).length >= 3)
		assert.ok(validateEnvelope({ runId: 'r', outputId: 'o', kind: 'bogus', seq: 0 }).length === 1)
		assert.deepEqual(
			validateEnvelope({ runId: 'r', outputId: 'o', kind: 'text.delta', seq: 0 }),
			[]
		)
	})
	it('ending one output leaves the run open until terminal', () => {
		const t = new RunTracker()
		t.endOutput('a')
		assert.ok(!t.isTerminal)
		assert.deepEqual(t.endedOutputs(), ['a'])
		t.finish('completed', 9)
		assert.ok(t.isTerminal)
		assert.equal(t.terminalState?.reason, 'completed')
	})
})

describe('schema', () => {
	it('generates shared identity; preserves required/optional/nullable', () => {
		const out = generateSchema(
			{ name: 'card', version: '2' },
			{
				name: 'Card',
				fields: {
					title: { scalar: 'string', nullable: false, optional: false },
					note: { scalar: 'string', nullable: true, optional: true },
					tags: {
						array: { scalar: 'string', nullable: false, optional: false },
						nullable: false,
						optional: true,
					},
				},
			}
		)
		assert.equal(out.jsonSchema.$id, 'card/2')
		assert.deepEqual((out.jsonSchema as { required: string[] }).required, ['title'])
		assert.ok(out.typeScript.includes('note?: string | null | undefined'))
	})
	it('fails generation on unsupported field types', () => {
		assert.throws(() =>
			generateSchema({ name: 'x', version: '1' }, { name: 'X', fields: { bad: null as never } })
		)
	})
})

describe('capabilities', () => {
	it('requires both sides; upload-only image input does not imply live video', () => {
		const sel = selectAdapter({ input: ['video'], output: ['text'] }, [textOnly, video])
		assert.equal(sel, null)
		assert.ok(
			capabilityFailure({ input: ['video'], output: ['text'] }, [textOnly, video]).includes(
				'input lacks: video'
			)
		)
	})
	it('selects a text run without opening devices', () => {
		const sel = selectAdapter({ input: ['text'], output: ['text'], structuredOutput: true }, [
			textOnly,
			video,
		])
		assert.equal(sel?.name, 'text')
	})
})

describe('trace', () => {
	it('records ordered events; cost estimate stays distinct from usage', () => {
		const sink = createMemorySink()
		sink.record({
			runId: 'r',
			outputId: 'a',
			seq: 0,
			kind: 'text.delta',
			usage: { inputTokens: 3 },
			estimatedCost: { currency: 'USD', amount: 0.001, basis: 'provider-reported' },
		})
		assert.equal(sink.events.length, 1)
		assert.notDeepEqual(sink.events[0].usage, sink.events[0].estimatedCost)
	})
	it('core index pulls no media dependency', async () => {
		const id = await import('../src/lib/index.js')
		assert.ok(typeof id.selectAdapter === 'function')
		const { readFileSync } = await import('node:fs')
		for (const f of [
			'index.js',
			'envelope.js',
			'schema.js',
			'capabilities.js',
			'trace.js',
			'boundary.js',
		]) {
			const src = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')
			assert.ok(!src.includes('@swelte/media'), `${f} must not reference @swelte/media`)
		}
	})
})
