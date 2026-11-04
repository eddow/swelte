// `@swelte/plus/jobs` — cron ticks (future.md #1, best-effort tier).
// Owns `@[cron]`: validate + single-scheduler emission. Core stays
// plugin-agnostic (registers `cron` via extraAttrs so the shape parses with
// bodies; ignores claimed fns everywhere unless this plugin is loaded).
// Emission: top-level `swelte_cron_N` fns (via `main`) + ONE scheduler thread
// (`spawn swelte_cron_run()` via `mainInner`, after @[startup]). The scheduler
// holds per-tick deadlines, sleeps to the nearest one (idle = one sleeping
// thread, zero wakeups/CPU), fires due ticks, and coalesces missed ticks
// (`next = now + every`, never a catch-up burst). Cron starts at boot in the
// container — no CLI, no SSH needed. Bodies must be idempotent
// (single-instance best-effort, no watchdog). Future: persistent tick log,
// missed-tick catchup, `retry(n)` + dead-letter.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineSweltePlugin, parseVFile, type SweltePlugin } from '@swelte/core/vite'

/** Duration literal for `@[cron]`: digits + s|m|h, nonzero (`'60s'`, `'5m'`, `'1h'`). */
export function plusCronSeconds(every: string): number {
	const m = /^([1-9][0-9]*)(s|m|h)$/.exec(every)
	if (!m) return 0
	const n = parseInt(m[1], 10)
	const mult = m[2] === 's' ? 1 : m[2] === 'm' ? 60 : 3600
	return n * mult
}

export interface JobsCronDef {
	name: string
	every: string
	seconds: number
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

/** Shape errors for one `@[cron]` fn (rel = file for messages). */
export function validateCronFn(rel: string, fn: CronFnShape): void {
	if (!fn.qualifier)
		throw new Error(
			`[swelte] ${rel}: @[cron] ${fn.name} needs a duration qualifier — @[cron('60s')] ('60s' | '5m' | '1h'), no cron-expr parser in v1.`
		)
	const seconds = plusCronSeconds(fn.qualifier)
	if (!seconds)
		throw new Error(
			`[swelte] ${rel}: @[cron] ${fn.name} has a bad duration ('${fn.qualifier}') — want digits + s|m|h, nonzero ('60s' | '5m' | '1h').`
		)
	const nparams = Array.isArray(fn.params) ? fn.params.length : 0
	if (nparams !== 0)
		throw new Error(`[swelte] ${rel}: @[cron] ${fn.name} takes no params (got ${nparams}).`)
	if (fn.vret !== 'void')
		throw new Error(`[swelte] ${rel}: @[cron] ${fn.name} must return void (got ${fn.vret || 'none'}).`)
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
 *  coalesces overruns (`next = now + every`, never a catch-up burst).
 *  Zero ticks → empty fragments (byte-identical harness when absent). */
export function cronHarness(crons: JobsCronDef[]): { main: string; mainInner: string } {
	if (crons.length === 0) return { main: '', mainInner: '' }
	let defs = ''
	const everies: number[] = []
	const calls: string[] = []
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
		calls.push(
			c.fallible
				? `swelte_cron_${n}() or { eprintln('[swelte:cron] ' + err.msg()) }`
				: `swelte_cron_${n}()`
		)
	}
	// No trailing newline: the harness splices `${frag.main}\nfn main()`.
	const inits = everies.map((sec) => `time.now().unix() + ${sec}`).join(', ')
	const arms = everies
		.map(
			(sec, i) =>
				`\t\tif now >= next[${i}] {\n\t\t\t${indent(calls[i])}\n\t\t\tnext[${i}] = now + ${sec}\n\t\t}`
		)
		.join('\n')
	// Scheduler fn is top-level (V forbids nested fns); only the spawn
	// lives inside `main`. `main` gains the trailing newline back so the
	// harness splice `${frag.main}\nfn main()` stays well-formed.
	const sched =
		'fn swelte_cron_run() {\n' +
		`\tmut next := [${inits}]\n` +
		'\tfor {\n' +
		'\t\tmut now := time.now().unix()\n' +
		'\t\twait := next[0] - now\n' +
		'\t\tfor d in next {\n' +
		'\t\t\tif d - now < wait { wait = d - now }\n' +
		'\t\t}\n' +
		'\t\tif wait > 0 { time.sleep(wait * time.second) }\n' +
		'\t\tnow = time.now().unix()\n' +
		`${arms}\n` +
		'\t}\n' +
		'}\n'
	const main = (defs + sched).endsWith('\n') ? (defs + sched).slice(0, -1) : defs + sched
	const mainInner =
		'// @[cron] (src/app.v) — one scheduler thread, sleeps to the nearest deadline.\n' +
		'// No watchdog: long-lived by design. Missed ticks coalesce (no pile-up).\n' +
		'\tspawn swelte_cron_run()\n'
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
		out.push({
			name: fn.name,
			every: fn.qualifier as string,
			seconds: plusCronSeconds(fn.qualifier as string),
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
