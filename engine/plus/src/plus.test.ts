// `@swelte/plus` — unit tests: jobs/cron (the only beyond-parity extraction).
// Run via `npm test --workspace=@swelte/plus` (tsconfig.test.json → dist-test).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { jobsPlugin, plusCronParse, plusCronSeconds } from './index.js'
import {
	dbHelperTemplate,
	dbInitialMigration,
	dbPlugin,
	plusDbPath,
	plusDbVlibDir,
	plusPendingMigrations,
	PLUS_DB_DEFAULT_PATH,
	PLUS_DB_MIGRATIONS_TABLE,
} from './index.js'

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
		const { validateCronFn } = await import('./jobs.js')
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
		const { cronHarness } = await import('./jobs.js')
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
		assert.ok(main.includes('fn swelte_cron_run() {'))
		assert.ok(main.includes('mut next := [time.now().unix() + 60, time.now().unix() + 300]'))
		assert.ok(main.includes('if wait > 0 { time.sleep(wait * time.second) }'))
		assert.ok(main.includes('next[0] = time.now().unix() + 60'))
		assert.ok(main.includes('next[1] = time.now().unix() + 300'))
		// Fallible without retry logs status=error; plain fns stay silent.
		assert.ok(main.includes("eprintln('[swelte:cron] tick=sweep status=error err=' + err.msg())"))
		assert.ok(!main.includes('tick=tick status=error'), 'first-try success stays silent')
		assert.ok(!main.includes('tick=tick status=retry'), 'plain tick has no retry loop')
		assert.ok(!main.includes('tick=tick status=dead'), 'plain tick has no dead-letter')
		// Catchup notice on lag >= 2 intervals (coalesce stays, now observable).
		assert.ok(main.includes('status=catchup lag='))
		assert.ok(main.includes('>= 120'))
		// Inside-main fragment: header + single spawn only.
		assert.deepEqual(mainInner.match(/spawn swelte_cron_run\(\)/g)?.length, 1)
		assert.ok(!mainInner.includes('swelte_cron_loop'), 'no per-tick spawns')
		assert.ok(mainInner.includes('// @[cron] (src/app.v)'))
		// Zero ticks → empty (byte-identical harness when absent).
		assert.deepEqual(cronHarness([]), { main: '', mainInner: '' })
	})

	it('cronHarness emits blocking retry loop + dead-letter for retry ticks', async () => {
		const { cronHarness } = await import('./jobs.js')
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
		assert.ok(main.includes('mut __a_1 := 0'))
		assert.ok(main.includes('for __a_1 <= 3 {'))
		// 5s linear backoff: attempt k sleeps (k+1)*5s.
		assert.ok(main.includes('time.sleep((__a_1 + 1) * 5 * time.second)'))
		// Console outcomes: retry notices, dead-letter, recovery ok.
		assert.ok(main.includes('tick=flaky status=retry attempt='))
		assert.ok(main.includes('tick=flaky status=dead attempt=3 err='))
		assert.ok(main.includes('tick=flaky status=ok attempt='))
		// Deadline advance uses parsed seconds, scheduler preserved.
		assert.ok(main.includes('next[0] = time.now().unix() + 60'))
		assert.deepEqual(mainInner.match(/spawn swelte_cron_run\(\)/g)?.length, 1)
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
			() =>
				jobsPlugin.validate?.('src/routes/+page.v', {
					name: 'tick',
					attr: 'cron',
					qualifier: '60s',
				}),
			/only allowed in src\/app\.v/
		)
	})
})

describe('db plugin (embedded SQLite)', () => {
	it('db plugin claims no attrs, exposes the migrate CLI', () => {
		assert.deepEqual(dbPlugin.attrs, [])
		assert.equal(dbPlugin.configKey, 'db')
		const names = (dbPlugin.cli ?? []).map((c) => c.name)
		assert.ok(names.includes('migrate'), 'dbPlugin needs the migrate command')
	})
	it('db plugin includes the backend V module dir', async () => {
		const { existsSync } = await import('node:fs')
		const { join } = await import('node:path')
		const incs = dbPlugin.includes?.() ?? []
		assert.equal(incs.length, 1)
		assert.equal(incs[0].module, 'backend')
		assert.ok(existsSync(join(incs[0].absDir, 'db.v')), 'vlib/backend/db.v ships')
		assert.equal(plusDbVlibDir(), incs[0].absDir)
	})
	it('plusDbPath honors SWELTE_DB_PATH, else the default', () => {
		assert.equal(PLUS_DB_DEFAULT_PATH, 'data/app.db')
		assert.equal(PLUS_DB_MIGRATIONS_TABLE, '_swelte_migrations')
		assert.ok(plusDbPath('/r', { SWELTE_DB_PATH: 'custom/x.db' }).endsWith('custom/x.db'))
		assert.ok(plusDbPath('/r', {}).endsWith('data/app.db'))
	})
	it('plusPendingMigrations sorts and subtracts applied', async () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const root = mkdtempSync(join(tmpdir(), 'swelte-db-'))
		mkdirSync(join(root, 'db', 'migrations'), { recursive: true })
		writeFileSync(join(root, 'db', 'migrations', '002_b.sql'), '-- b')
		writeFileSync(join(root, 'db', 'migrations', '001_a.sql'), '-- a')
		writeFileSync(join(root, 'db', 'migrations', 'note.txt'), 'ignore me')
		assert.deepEqual(plusPendingMigrations(root, ['001_a.sql']), ['002_b.sql'])
		assert.deepEqual(plusPendingMigrations(root, []), ['001_a.sql', '002_b.sql'])
	})
	it('dbHelperTemplate is backend-shaped (WAL, shared conn, KV)', () => {
		const src = dbHelperTemplate()
		assert.ok(src.includes('module backend'))
		assert.ok(src.includes('import db.sqlite'))
		assert.ok(src.includes('journal_mode = WAL'))
		assert.ok(src.includes('exec_none'))
		assert.ok(src.includes('pub fn db() !sqlite.DB'))
		assert.ok(src.includes('pub fn kv_set('))
		assert.ok(src.includes('pub fn kv_get('))
		assert.ok(src.includes('pub fn kv_del('))
	})
	it('dbInitialMigration creates the KV table', () => {
		assert.ok(dbInitialMigration().includes('create table if not exists swelte_kv'))
	})
})
