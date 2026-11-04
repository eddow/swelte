// `@swelte/plus` — unit tests: plugin contracts + channel/outbox helpers.
// Run via `npm test --workspace=@swelte/plus` (tsconfig.test.json → dist-test).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
	assertChannelName,
	channelJoinFrame,
	jobsPlugin,
	outboxKey,
	outboxPlugin,
	parseChannelJoinFrame,
	plusCronSeconds,
	sseChannelsPlugin,
	swrPlugin,
} from './index.js'

describe('plus contracts', () => {
	it('plugins expose name/configKey; augment-only plugins claim no attrs', () => {
		for (const p of [sseChannelsPlugin, swrPlugin, outboxPlugin]) {
			assert.ok(p.name, 'plugin needs a name')
			assert.ok(p.configKey, `${p.name} needs a configKey`)
			assert.deepEqual(p.attrs, [], `${p.name} claims no attrs`)
		}
	})

	it('jobs plugin claims cron (moved out of core)', () => {
		assert.deepEqual(jobsPlugin.attrs, ['cron'])
		assert.equal(jobsPlugin.configKey, 'jobs')
		assert.ok(jobsPlugin.validate, 'jobsPlugin needs validate')
		assert.ok(jobsPlugin.loadAppHooks, 'jobsPlugin needs loadAppHooks')
	})

	it('jobs plugin exposes a `jobs` CLI command', () => {
		const cmd = jobsPlugin.cli?.find((c) => c.name === 'jobs')
		assert.ok(cmd, 'jobsPlugin.cli should include `jobs`')
	})
})

describe('plus helpers', () => {
	it('plusCronSeconds parses duration literals', () => {
		assert.equal(plusCronSeconds('60s'), 60)
		assert.equal(plusCronSeconds('5m'), 300)
		assert.equal(plusCronSeconds('1h'), 3600)
		assert.equal(plusCronSeconds('daily'), 0)
	})

	it('channel join frames round-trip', () => {
		assert.equal(channelJoinFrame('lobby'), 'swelte:join:lobby')
		assert.equal(parseChannelJoinFrame('swelte:join:lobby'), 'lobby')
		assert.equal(parseChannelJoinFrame('tick 1'), null)
		assert.throws(() => channelJoinFrame('bad room!'), /bad SSE channel/)
	})

	it('outbox keys are stable method:url:ts triples', () => {
		const e = { url: '/api/save', method: 'POST', ts: 42 }
		assert.equal(outboxKey(e), 'POST:/api/save:42')
	})
})

describe('jobs cron (moved from core generate-errors.test.ts)', () => {
	it('validateCronFn rejects bad shapes', async () => {
		const { validateCronFn } = await import('./jobs.js')
		assert.throws(() => validateCronFn('src/app.v', { name: 'tick', attr: 'cron' }), /needs a duration qualifier/)
		assert.throws(
			() => validateCronFn('src/app.v', { name: 'tick', attr: 'cron', qualifier: 'daily', vret: 'void', params: [] }),
			/bad duration/
		)
		assert.throws(
			() => validateCronFn('src/app.v', { name: 'tick', attr: 'cron', qualifier: '60s', vret: 'void', params: [1] }),
			/takes no params/
		)
		assert.throws(
			() => validateCronFn('src/app.v', { name: 'tick', attr: 'cron', qualifier: '60s', vret: 'string', params: [] }),
			/must return void/
		)
	})

	it('cronHarness emits byte-identical spawn loops (old core splice)', async () => {
		const { cronHarness } = await import('./jobs.js')
		const { main, mainInner } = cronHarness([
			{ name: 'tick', every: '60s', seconds: 60, body: "\n\tprintln('tick')\n", fallible: false },
			{ name: 'sweep', every: '5m', seconds: 300, body: "\n\tprintln('sweep')\n", fallible: true },
		])
		assert.ok(main.includes('fn swelte_cron_1() {'))
		assert.ok(main.includes('fn swelte_cron_2() !void {'))
		assert.ok(main.includes('time.sleep(60 * time.second)'))
		assert.ok(main.includes('time.sleep(300 * time.second)'))
		assert.ok(main.includes("eprintln('[swelte:cron] ' + err.msg())"))
		assert.ok(mainInner.includes('spawn swelte_cron_loop_1()'))
		assert.ok(mainInner.includes('spawn swelte_cron_loop_2()'))
		assert.ok(mainInner.includes('// @[cron] (src/app.v)'))
	})

	it('loadAppHooks collects src/app.v crons; errors surface as errors[]', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const root = mkdtempSync(join(tmpdir(), 'swelte-jobs-'))
		mkdirSync(join(root, 'src'), { recursive: true })
		writeFileSync(
			join(root, 'src', 'app.v'),
			"module s\n@[cron('60s')]\npub fn tick() {\n\tprintln('tick')\n}\n@[cron('5m')]\npub fn sweep() !void {\n\tprintln('sweep')\n}"
		)
		const got = jobsPlugin.loadAppHooks?.(root)
		assert.ok(!got?.errors, `unexpected errors: ${got?.errors}`)
		const frag = got?.fragment
		assert.ok(frag?.main?.includes('fn swelte_cron_1() {'))
		assert.ok(frag?.mainInner?.includes('spawn swelte_cron_loop_2()'))
		// Missing qualifier → errors[], not a throw (core throws it).
		writeFileSync(join(root, 'src', 'app.v'), 'module s\n@[cron]\npub fn tick() { }')
		const bad = jobsPlugin.loadAppHooks?.(root)
		assert.ok(bad?.errors?.length, 'expected errors[] for missing qualifier')
		assert.match(bad.errors[0] as string, /needs a duration qualifier/)
		// Missing file → empty (byte-identical harness when absent).
		const empty = mkdtempSync(join(tmpdir(), 'swelte-jobs-empty-'))
		assert.deepEqual(jobsPlugin.loadAppHooks?.(empty), {})
	})

	it('validate() rejects misplaced @[cron] in routes', async () => {
		assert.throws(
			() => jobsPlugin.validate?.('src/routes/+page.v', { name: 'tick', attr: 'cron', qualifier: '60s' }),
		/only allowed in src\/app\.v/
		)
	})
})
