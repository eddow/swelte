// `@swelte/plus/jobs` — cron ticks (future.md #1, best-effort tier).
// Owns `@[cron]`: validate + single-scheduler emission. Core stays
// plugin-agnostic (registers `cron` via extraAttrs so the shape parses with
// bodies; ignores claimed fns everywhere unless this plugin is loaded).
// Emission: top-level `swelte_cron_N` fns (via `main`) + ONE scheduler thread
// (`spawn swelte_cron_run()` via `mainInner`, after @[startup]). The scheduler
// holds per-tick deadlines, sleeps to the nearest one (idle = one sleeping
// thread, zero wakeups/CPU), fires due ticks, and coalesces missed ticks
// (`next = now + every`, never a catch-up burst) with a console `catchup`
// notice when lag >= 2 intervals. Cron starts at boot in the
// container — no CLI, no SSH needed. Bodies must be idempotent
// (single-instance best-effort, no watchdog). Retry: optional `,retry=n`
// qualifier suffix (1..5, fallible `!void` only, 5s linear backoff,
// blocking that tick's arm). Outcomes go to the console
// (`eprintln('[swelte:cron] tick=.. status=..')`) — no log file by design.
// Future: persistent tick log, cross-restart catchup.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineSweltePlugin, parseVFile, type SweltePlugin } from '@swelte/core/vite'

/** Duration literal for `@[cron]`: digits + s|m|h, nonzero (`'60s'`, `'5m'`, `'1h'`). */
export function plusCronSeconds(every: string): number {
	const m = /^([1-9][0-9]*)(s|m|h)$/.exec(every.trim())
	if (!m) return 0
	const n = parseInt(m[1], 10)
	const mult = m[2] === 's' ? 1 : m[2] === 'm' ? 60 : 3600
	return n * mult
}

/** Max `retry=` attempts after the first failure (bounded: retries block the tick's arm). */
export const PLUS_CRON_MAX_RETRY = 5
/** Linear backoff step between attempts (seconds). Attempt k sleeps k * step. */
export const PLUS_CRON_RETRY_STEP_S = 5

/** Parsed `@[cron]` qualifier: `<duration>[,retry=<n>]` (whitespace tolerated). */
export interface PlusCronQualifier {
	seconds: number
	retry: number
}

/** Parse a `@[cron]` qualifier (`'60s'`, `'5m,retry=3'`). Returns null on bad shape. */
export function plusCronParse(qualifier: string): PlusCronQualifier | null {
	const parts = qualifier.split(',')
	if (parts.length > 2) return null
	const seconds = plusCronSeconds(parts[0])
	if (!seconds) return null
	if (parts.length === 1) return { seconds, retry: 0 }
	const rm = /^\s*retry\s*=\s*([0-9]+)\s*$/.exec(parts[1])
	if (!rm) return null
	const retry = parseInt(rm[1], 10)
	if (retry < 1 || retry > PLUS_CRON_MAX_RETRY) return null
	return { seconds, retry }
}

export interface JobsCronDef {
	name: string
	every: string
	seconds: number
	retry: number
	body: string
	fallible: boolean
}

/** Minimal fn shape (core `validate` contract + the fields cron checks). */
export interface CronFnShape {
	name: string
	attr: string
	qualifier?: string
	params?: { length: number } | unknown[]
	vret?: string
	hookBody?: string
	fallible?: boolean
}

/** Shape errors for one `@[cron]` fn (rel = file for messages).
 *  Qualifier: `'60s'` (or `'5m'` / `'1h'`), optional `,retry=n` suffix
 *  (`1..PLUS_CRON_MAX_RETRY`, fallible `!void` fns only). */
export function validateCronFn(rel: string, fn: CronFnShape): void {
	if (!fn.qualifier)
		throw new Error(
			`[swelte] ${rel}: @[cron] ${fn.name} needs a duration qualifier — @[cron('60s')] ('60s' | '5m' | '1h', optional ',retry=n'), no cron-expr parser in v1.`
		)
	const parsed = plusCronParse(fn.qualifier)
	if (!parsed) {
		if (plusCronSeconds(fn.qualifier.split(',')[0]) === 0)
			throw new Error(
				`[swelte] ${rel}: @[cron] ${fn.name} has a bad duration ('${fn.qualifier}') — want digits + s|m|h, nonzero ('60s' | '5m' | '1h').`
			)
		throw new Error(
			`[swelte] ${rel}: @[cron] ${fn.name} has a bad retry suffix ('${fn.qualifier}') — want retry=1..${PLUS_CRON_MAX_RETRY}, e.g. @[cron('60s,retry=3')].`
		)
	}
	if (parsed.retry > 0 && !fn.fallible)
		throw new Error(
			`[swelte] ${rel}: @[cron] ${fn.name} retry=${parsed.retry} needs a fallible fn (!void) — void fns cannot fail so there is nothing to retry.`
		)
	const nparams = Array.isArray(fn.params) ? fn.params.length : 0
	if (nparams !== 0)
		throw new Error(`[swelte] ${rel}: @[cron] ${fn.name} takes no params (got ${nparams}).`)
	if (fn.vret !== 'void')
		throw new Error(
			`[swelte] ${rel}: @[cron] ${fn.name} must return void (got ${fn.vret || 'none'}).`
		)
}

/** Body indent: blank lines stay blank (matches core hook splicing). */
function indent(body: string): string {
	return body
		.split('\n')
		.map((l) => (l.trim() === '' ? '' : '\t' + l))
		.join('\n')
}

/** V fragments for validated cron defs: ONE scheduler thread.
 *  `main`: top-level `swelte_cron_N` fns (user bodies, compile even when
 *  fallible). `mainInner`: `// @[cron]` header + `spawn swelte_cron_run()`
 *  + the `swelte_cron_run` multiplexer, spliced inside `main` before
 *  `mut app := &App{}` (after @[startup] injection). The loop holds a
 *  `next[i]` deadline (unix seconds) per tick, sleeps to the nearest one
 *  (idle = a single sleeping thread, no wakeups), fires due ticks, and
 *  coalesces overruns (`next = now + every`, never a catch-up burst) with a
 *  console `status=catchup` notice when lag >= 2 intervals.
 *  Retries (`retry=n`, fallible only) run a blocking linear-backoff loop
 *  (`(attempt+1) * 5s`) inside the tick's arm — the scheduler thread is
 *  preserved. All outcomes go to the console (`eprintln('[swelte:cron] ..')`):
 *  first-try success stays silent; `status=retry|dead|ok` (recovery) and
 *  `status=catchup` are logged. Non-fallible + no-retry ticks emit today's
 *  shape (byte-identical). Zero ticks → empty fragments (byte-identical
 *  harness when absent). */
export function cronHarness(crons: JobsCronDef[]): { main: string; mainInner: string } {
	if (crons.length === 0) return { main: '', mainInner: '' }
	let defs = ''
	const everies: number[] = []
	const arms: string[] = []
	let n = 0
	for (const c of crons) {
		n++
		const sig = c.fallible ? `fn swelte_cron_${n}() !void {` : `fn swelte_cron_${n}() {`
		defs +=
			`// @[cron] tick ${n} (src/app.v) — user body, top-level so fallible fns compile.\n` +
			`${sig}\n` +
			indent(c.body) +
			'\n}\n'
		everies.push(c.seconds)
		const tag = `tick=${c.name}`
		const retry = c.fallible ? (c.retry ?? 0) : 0
		let fire: string
		if (retry > 0) {
			// Blocking retry loop: fallible call inside `or {}`. V var names
			// are tick-scoped (`__a_N`/`__ok_N`); `err` is the `or`-block var.
			fire = `mut __a_${n} := 0
			mut __ok_${n} := false
			for __a_${n} <= ${retry} {
				swelte_cron_${n}() or {
					if __a_${n} == ${retry} {
						eprintln('[swelte:cron] ${tag} status=dead attempt=${retry} err=' + err.msg())
					} else {
						eprintln('[swelte:cron] ${tag} status=retry attempt=' + __a_${n}.str() + ' err=' + err.msg())
						time.sleep((__a_${n} + 1) * ${PLUS_CRON_RETRY_STEP_S} * time.second)
					}
					__a_${n}++
					continue
				}
				if __a_${n} > 0 {
					eprintln('[swelte:cron] ${tag} status=ok attempt=' + __a_${n}.str())
				}
				__ok_${n} = true
				break
			}
			_ = __ok_${n}`
		} else if (c.fallible) {
			fire = `swelte_cron_${n}() or { eprintln('[swelte:cron] ${tag} status=error err=' + err.msg()) }`
		} else {
			fire = `swelte_cron_${n}()`
		}
		arms.push(
			`		if now >= next[${n - 1}] {
			if now - next[${n - 1}] >= ${c.seconds * 2} {
				eprintln('[swelte:cron] ${tag} status=catchup lag=' + (now - next[${n - 1}]).str() + 's')
			}
			${indent(fire)}
			next[${n - 1}] = time.now().unix() + ${c.seconds}
		}`
		)
	}
	// No trailing newline: the harness splices `${frag.main}\nfn main()`.
	const inits = everies.map((sec) => `time.now().unix() + ${sec}`).join(', ')
	// Scheduler fn is top-level (V forbids nested fns); only the spawn
	// lives inside `main`. `main` gains the trailing newline back so the
	// harness splice `${frag.main}\nfn main()` stays well-formed.
	const sched = `fn swelte_cron_run() {
	mut next := [${inits}]
	for {
		mut now := time.now().unix()
		mut wait := next[0] - now
		for d in next {
			if d - now < wait { wait = d - now }
		}
		if wait > 0 { time.sleep(wait * time.second) }
		now = time.now().unix()
${arms}
	}
}
`
	const main = (defs + sched).endsWith('\n') ? (defs + sched).slice(0, -1) : defs + sched
	const mainInner = `// @[cron] (src/app.v) — one scheduler thread, sleeps to the nearest deadline.
// No watchdog: long-lived by design. Missed ticks coalesce (no pile-up),
// with a status=catchup console notice when lag >= 2 intervals.
// Outcomes log to the console ([swelte:cron] tick=.. status=..) — no file.
	spawn swelte_cron_run()`
	return { main, mainInner }
}

/** Read + validate `src/app.v` `@[cron]` fns (sync — matches the core contract). */
export function readJobsCrons(root: string, srcDir = 'src'): JobsCronDef[] {
	const rel = `${srcDir}/app.v`
	let src = ''
	try {
		src = readFileSync(join(root, srcDir, 'app.v'), 'utf8')
	} catch {
		return []
	}
	const out: JobsCronDef[] = []
	const seen = new Set<string>()
	for (const fn of parseVFile(src, ['cron'])) {
		if (fn.attr !== 'cron') continue
		validateCronFn(rel, fn as unknown as CronFnShape)
		const body = (fn as unknown as { hookBody?: string }).hookBody
		if (body === undefined)
			throw new Error(`[swelte] ${rel}: @[cron] ${fn.name} has no body to inline.`)
		const key = `${fn.qualifier}::${body}`
		if (seen.has(key))
			throw new Error(
				`[swelte] ${rel}: duplicate @[cron('${fn.qualifier}')] body on ${fn.name} — one loop per fn.`
			)
		seen.add(key)
		const parsed = plusCronParse(fn.qualifier as string)
		// validateCronFn above guarantees non-null; parse once more for the def.
		const seconds = parsed?.seconds ?? 0
		const retry = parsed?.retry ?? 0
		out.push({
			name: fn.name,
			every: fn.qualifier as string,
			seconds,
			retry,
			body,
			fallible: fn.fallible,
		})
	}
	return out
}

export const jobsPlugin: SweltePlugin = defineSweltePlugin({
	name: 'jobs',
	attrs: ['cron'],
	configKey: 'jobs',
	// Core calls validate() only for fns in route files; `@[cron]` lives in
	// `src/app.v` (parsed by loadAppHooks below). Any cron reaching validate
	// is misplaced — reject it here (core's own-file guard is core-attr-only).
	validate: (rel, fn) => {
		if (fn.attr !== 'cron') return
		if (!/(^|\/)src\/app\.v$/.test(rel) && !/(^|\/)app\.v$/.test(rel))
			throw new Error(
				`[swelte] ${rel}: @[cron] ${fn.name} is only allowed in src/app.v (one-or-more fns, qualifier is the duration literal).`
			)
		validateCronFn(rel, fn as unknown as CronFnShape)
	},
	loadAppHooks: (root, srcDir = 'src') => {
		try {
			const crons = readJobsCrons(root, srcDir)
			if (crons.length === 0) return {}
			return { fragment: cronHarness(crons) }
		} catch (e) {
			return { errors: [(e as Error).message] }
		}
	},
})
