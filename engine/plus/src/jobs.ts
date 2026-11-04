// `@swelte/plus/jobs` — cron → jobs (future.md #1).
// Owns `@[cron]`: validate + spawn-loop emission. Core stays plugin-agnostic
// (parses `cron` fns so the shape survives, ignores them everywhere unless
// this plugin is loaded). Codegen is byte-identical to the old core splice:
// top-level `swelte_cron_N`/`swelte_cron_loop_N` fns (via `main`) + spawns
// inside `main` after `mut app := &App{}` (via `mainInner`), after @[startup].
// Future: persistent tick log, missed-tick catchup, `retry(n)` + dead-letter.
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

/** V fragments for validated cron defs (byte-identical to the old core splice). */
export function cronHarness(crons: JobsCronDef[]): { main: string; mainInner: string } {
	let defs = ''
	let spawns = ''
	let n = 0
	for (const c of crons) {
		n++
		const sig = c.fallible ? `fn swelte_cron_${n}() !void {` : `fn swelte_cron_${n}() {`
		const call = c.fallible
			? `swelte_cron_${n}() or { eprintln('[swelte:cron] ' + err.msg()) }`
			: `swelte_cron_${n}()`
		defs +=
			`// @[cron] tick ${n} (src/app.v) — user body, top-level so fallible fns compile.\n` +
			`${sig}\n` +
			indent(c.body) +
			'\n}\n' +
			`fn swelte_cron_loop_${n}() {\n\tfor {\n\t\ttime.sleep(${c.seconds} * time.second)\n` +
			indent(call) +
			'\n\t}\n}\n'
		spawns += `\tspawn swelte_cron_loop_${n}()\n`
	}
	// No trailing newline: the harness splices `${frag.main}\nfn main()`, which
	// reproduces the old `defs + anchor` join byte for byte.
	const main = defs.endsWith('\n') ? defs.slice(0, -1) : defs
	const mainInner =
		'// @[cron] (src/app.v) — spawn + time.sleep loops, single-instance best-effort.\n' +
		'// No watchdog: long-lived by design. Bodies must be idempotent.\n' +
		spawns
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
	cli: [
		{
			name: 'jobs',
			summary: 'List cron ticks (persistent log — plus jobs lands next).',
			run(ctx) {
				ctx.log('no tick log yet (cron is best-effort spawn+sleep; persistent log lands next)')
			},
		},
	],
})
