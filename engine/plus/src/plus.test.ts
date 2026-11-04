// `@swelte/plus` — unit tests: jobs/cron (the only beyond-parity extraction).
// Run via `npm test --workspace=@swelte/plus` (tsconfig.test.json → dist-test).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { jobsPlugin, plusCronSeconds } from './index.js'

describe('plus contracts', () => {
	it('jobs plugin claims cron (moved out of core)', () => {
		assert.deepEqual(jobsPlugin.attrs, ['cron'])
		assert.equal(jobsPlugin.configKey, 'jobs')
		assert.ok(jobsPlugin.validate, 'jobsPlugin needs validate')
		assert.ok(jobsPlugin.loadAppHooks, 'jobsPlugin needs loadAppHooks')
	})

	it('jobs plugin exposes no CLI (container: cron runs at startup, no SSH)', () => {
		assert.ok(!jobsPlugin.cli?.length, 'jobsPlugin must not ship server CLI commands')
	})

	it('plusCronSeconds parses duration literals', () => {
		assert.equal(plusCronSeconds('60s'), 60)
		assert.equal(plusCronSeconds('5m'), 300)
		assert.equal(plusCronSeconds('1h'), 3600)
		assert.equal(plusCronSeconds('daily'), 0)
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

	it('cronHarness emits ONE scheduler thread (no per-tick loops)', async () => {
		const { cronHarness } = await import('./jobs.js')
		const { main, mainInner } = cronHarness([
			{ name: 'tick', every: '60s', seconds: 60, body: "\n\tprintln('tick')\n", fallible: false },
			{ name: 'sweep', every: '5m', seconds: 300, body: "\n\tprintln('sweep')\n", fallible: true },
		])
		// Top-level user fns (fallible-safe), no per-tick loop fns.
		assert.ok(main.includes('fn swelte_cron_1() {'))
		assert.ok(main.includes('fn swelte_cron_2() !void {'))
		assert.ok(!main.includes('swelte_cron_loop'), 'no per-tick loops: one scheduler thread')
		// Scheduler: single fn, deadline array, nearest-deadline sleep, coalesce.
		assert.ok(main.includes('fn swelte_cron_run() {'))
		assert.ok(main.includes('mut next := [time.now().unix() + 60, time.now().unix() + 300]'))
		assert.ok(main.includes('if wait > 0 { time.sleep(wait * time.second) }'))
		assert.ok(main.includes('next[0] = now + 60'))
		assert.ok(main.includes('next[1] = now + 300'))
		assert.ok(main.includes("eprintln('[swelte:cron] ' + err.msg())"))
		// Inside-main fragment: header + single spawn only.
		assert.deepEqual(mainInner.match(/spawn swelte_cron_run\(\)/g)?.length, 1)
		assert.ok(!mainInner.includes('swelte_cron_loop'), 'no per-tick spawns')
		assert.ok(mainInner.includes('// @[cron] (src/app.v)'))
		// Zero ticks → empty (byte-identical harness when absent).
		assert.deepEqual(cronHarness([]), { main: '', mainInner: '' })
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
		assert.ok(frag?.mainInner?.includes('spawn swelte_cron_run()'))
		assert.ok(!frag?.mainInner?.includes('swelte_cron_loop'), 'single scheduler thread')
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
