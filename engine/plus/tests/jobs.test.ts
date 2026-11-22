// `@swelte/plus/jobs` — unit tests: explicit cron plugin (moved from core).
// Run via `npm test --workspace=@swelte/plus` (tsconfig.test.json → dist-test).

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
import {
	createJobsPlugin,
	jobsPlugin,
	PLUS_CRON_MAX_RETRY,
	PLUS_CRON_RETRY_STEP_S,
	plusCronParse,
	plusCronSeconds,
} from '../src/jobs.js'

describe('jobs contracts (explicit cron plugin)', () => {
	it('jobs plugin claims cron (plus-owned)', () => {
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

	it('plusCronParse parses the qualifier DSL (duration + optional retry)', () => {
		assert.deepEqual(plusCronParse('60s'), { seconds: 60, retry: 0 })
		assert.deepEqual(plusCronParse('5m,retry=3'), { seconds: 300, retry: 3 })
		assert.deepEqual(plusCronParse('1h, retry=2'), { seconds: 3600, retry: 2 })
		assert.deepEqual(plusCronParse('10s,retry=5'), { seconds: 10, retry: 5 })
		assert.equal(plusCronParse('daily'), null)
		assert.equal(plusCronParse('60s,retry=0'), null)
		assert.equal(plusCronParse('60s,retry=6'), null)
		assert.equal(plusCronParse('60s,retry=x'), null)
		assert.equal(plusCronParse('60s,backoff=3'), null)
		assert.equal(plusCronParse('60s,retry=2,extra=1'), null)
	})
})


describe('jobs cron (moved from core generate-errors.test.ts)', () => {
	it('validateCronFn rejects bad shapes', async () => {
		const { validateCronFn } = await import('../src/jobs.js')
		assert.throws(
			() => validateCronFn('src/app.v', { name: 'tick', attr: 'cron' }),
			/needs a duration qualifier/
		)
		assert.throws(
			() =>
				validateCronFn('src/app.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: 'daily',
					vret: 'void',
					params: [],
				}),
			/bad duration/
		)
		assert.throws(
			() =>
				validateCronFn('src/app.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s',
					vret: 'void',
					params: [1],
				}),
			/takes no params/
		)
		assert.throws(
			() =>
				validateCronFn('src/app.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s',
					vret: 'string',
					params: [],
				}),
			/must return void/
		)
		// Qualifier DSL: retry suffix accepted on fallible fns only.
		validateCronFn('src/app.v', {
			name: 'tick',
			attr: 'cron',
			qualifier: '60s,retry=3',
			vret: 'void',
			fallible: true,
			params: [],
		})
		assert.throws(
			() =>
				validateCronFn('src/app.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s,retry=3',
					vret: 'void',
					fallible: false,
					params: [],
				}),
			/needs a fallible fn/
		)
		assert.throws(
			() =>
				validateCronFn('src/app.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s,retry=0',
					vret: 'void',
					fallible: true,
					params: [],
				}),
			/bad retry suffix/
		)
		assert.throws(
			() =>
				validateCronFn('src/app.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s,retry=9',
					vret: 'void',
					fallible: true,
					params: [],
				}),
			/bad retry suffix/
		)
		assert.throws(
			() =>
				validateCronFn('src/app.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s,backoff=3',
					vret: 'void',
					fallible: true,
					params: [],
				}),
			/bad retry suffix/
		)
	})

	it('cronHarness emits ONE scheduler thread (no per-tick loops)', async () => {
		const { cronHarness } = await import('../src/jobs.js')
		const { main, mainInner } = cronHarness([
			{
				name: 'tick',
				every: '60s',
				seconds: 60,
				retry: 0,
				body: "\n\tprintln('tick')\n",
				fallible: false,
			},
			{
				name: 'sweep',
				every: '5m',
				seconds: 300,
				retry: 0,
				body: "\n\tprintln('sweep')\n",
				fallible: true,
			},
		])
		// Top-level user fns (fallible-safe), no per-tick loop fns.
		assert.ok(main.includes('fn swelte_cron_1() {'))
		assert.ok(main.includes('fn swelte_cron_2() !void {'))
		assert.ok(!main.includes('swelte_cron_loop'), 'no per-tick loops: one scheduler thread')
		// Scheduler: single fn, deadline array, nearest-deadline sleep, coalesce.
		assert.ok(main.includes('fn swelte_cron_run(lifecycle &SwelteLifecycle) {'))
		assert.ok(main.includes('mut next := [time.now().unix() + 60, time.now().unix() + 300]'))
		assert.ok(main.includes('swelte_wait_active(wait * 1000, state)'))
		assert.ok(main.includes('defer { state.end() }'))
		assert.ok(main.includes('next[0] = time.now().unix() + 60'))
		assert.ok(main.includes('next[1] = time.now().unix() + 300'))
		// Fallible without retry logs status=error; plain fns stay silent.
		assert.ok(main.includes("eprintln('[swelte:cron] tick=sweep status=error reason=failed')"))
		assert.ok(main.includes("path: 'cron/sweep', status: 500, message: err.msg()"))
		assert.ok(!main.includes('tick=tick status=error'), 'first-try success stays silent')
		assert.ok(!main.includes('tick=tick status=retry'), 'plain tick has no retry loop')
		assert.ok(!main.includes('tick=tick status=dead'), 'plain tick has no dead-letter')
		// Catchup notice on lag >= 2 intervals (coalesce stays, now observable).
		assert.ok(main.includes('status=catchup lag='))
		assert.ok(main.includes('>= 120'))
		// Inside-main fragment: header + single spawn only.
		assert.ok(mainInner.includes('mut lifecycle := &app.lifecycle'), 'lifecycle captured mutably before the spawn')
		assert.ok(mainInner.includes('if lifecycle.begin()'), 'begin runs on the captured reference')
		assert.deepEqual(mainInner.match(/spawn swelte_cron_run\(lifecycle/g)?.length, 1)
		assert.ok(!mainInner.includes('swelte_cron_loop'), 'no per-tick spawns')
		assert.ok(mainInner.includes('// @[cron] (src/app.v)'))
		// Zero ticks → empty (byte-identical harness when absent).
		assert.deepEqual(cronHarness([]), { main: '', mainInner: '' })
	})

	it('cronHarness emits blocking retry loop + dead-letter for retry ticks', async () => {
		const { cronHarness } = await import('../src/jobs.js')
		const { main, mainInner } = cronHarness([
			{
				name: 'flaky',
				every: '60s,retry=3',
				seconds: 60,
				retry: 3,
				body: "\n\tprintln('flaky')\n",
				fallible: true,
			},
		])
		assert.ok(main.includes('fn swelte_cron_1() !void {'))
		// Retry loop scaffolding (tick-scoped vars, bound 3).
		assert.ok(main.includes('mut swelte_attempt_1 := 0'))
		assert.ok(main.includes('for swelte_attempt_1 <= 3 {'))
		// 5s linear backoff: attempt k sleeps (k+1)*5s.
		assert.ok(main.includes('swelte_wait_active((swelte_attempt_1 + 1) * 5 * 1000, state)'))
		// Console outcomes: retry notices, dead-letter, recovery ok.
		assert.ok(main.includes('tick=flaky status=retry attempt='))
		assert.ok(main.includes('tick=flaky status=dead attempt=3 reason=failed'))
		assert.ok(main.includes('tick=flaky status=ok attempt='))
		// Deadline advance uses parsed seconds, scheduler preserved.
		assert.ok(main.includes('next[0] = time.now().unix() + 60'))
		assert.ok(mainInner.includes('mut lifecycle := &app.lifecycle'), 'lifecycle captured mutably before the spawn')
		assert.ok(mainInner.includes('if lifecycle.begin()'), 'begin runs on the captured reference')
		assert.deepEqual(mainInner.match(/spawn swelte_cron_run\(lifecycle/g)?.length, 1)
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
		assert.ok(frag?.mainInner?.includes('swelte_cron_run(lifecycle'))
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
			() =>
				jobsPlugin.validate?.('src/routes/+page.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s',
				}),
			/only allowed in src\/app\.v/
		)
	})

	describe('§3 cron extraction — core + Plus generate', () => {
		const mkApp = () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const os = require('node:os') as typeof import('node:os')
			const path = require('node:path') as typeof import('node:path')
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-plus-jobs-'))
			fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true })
			fs.mkdirSync(path.join(root, 'src'), { recursive: true })
			fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","type":"module"}')
			fs.writeFileSync(path.join(root, 'svelte.config.js'), 'export default {}')
			fs.writeFileSync(
				path.join(root, 'src', 'routes', '+page.v'),
				'module p\n@[get]\npub fn g() string {\n\treturn ""\n}\n',
			)
			fs.writeFileSync(
				path.join(root, 'src', 'app.v'),
				"module s\n@[cron('60s')]\npub fn tick() { println('t') }",
			)
			return root
		}
		const generateWith = async (root: string, plugins: import('@swelte/core/vite').SweltePlugin[]) => {
			const { swelte } = await import('@swelte/core/vite')
			const plug = swelte({ plugins }) as unknown as {
				configResolved?: (c: { root: string }) => void
				buildStart?: () => Promise<void>
			}
			plug.configResolved?.({ root })
			await plug.buildStart?.()
		}
		it('Plus jobs plugin emits one scheduler; core-only stays inert', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const { jobsPlugin } = await import('../src/jobs.js')
			// With the plugin: one scheduler thread spliced into server.v.
			let root = mkApp()
			try {
				await generateWith(root, [jobsPlugin])
				const sv = fs.readFileSync(path.join(root, '.swelte', 'server.v'), 'utf8')
				assert.equal(sv.split('fn swelte_cron_run').length - 1, 1, 'one scheduler with the Plus jobs plugin')
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
			// Without it: the same `@[cron]` tick stays inert.
			root = mkApp()
			try {
				await generateWith(root, [])
				const sv = fs.readFileSync(path.join(root, '.swelte', 'server.v'), 'utf8')
				assert.ok(!sv.includes('swelte_cron'), 'core emits no cron loops without Plus')
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
		it('durability opt-in: durable jobs plugin stages the sweltejobs module', async () => {
			const { createJobsPlugin } = await import('../src/jobs.js')
			const incs = createJobsPlugin({ durable: true }).includes?.() ?? []
			assert.equal(incs.length, 1)
			assert.equal(incs[0].module, 'sweltejobs')
			const nonDurable = createJobsPlugin().includes?.() ?? []
			assert.deepEqual(nonDurable, [], 'non-durable emits no extra module')
		})
		it('misplaced @[cron] in routes fails naming src/app.v', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const { jobsPlugin } = await import('../src/jobs.js')
			const root = mkApp()
			try {
				fs.writeFileSync(
					path.join(root, 'src', 'routes', '+page.v'),
					"module p\n@[cron('60s')]\npub fn tick() { }\n@[get]\npub fn g() string {\n\treturn ''\n}\n",
				)
				await assert.rejects(() => generateWith(root, [jobsPlugin]), /only allowed in src\/app\.v/)
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
		it('shape-invalid tick fails naming the qualifier rule', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const { jobsPlugin } = await import('../src/jobs.js')
			const root = mkApp()
			try {
				fs.writeFileSync(path.join(root, 'src', 'app.v'), 'module s\n@[cron]\npub fn tick() { }')
				await assert.rejects(() => generateWith(root, [jobsPlugin]), /needs a duration qualifier/)
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
	})
})
