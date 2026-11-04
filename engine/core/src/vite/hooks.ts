import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseVFile } from './parse.js'
import type { RpcFn, ServerHooks } from './types.js'

/** Duration literal for `@[cron]`: digits + s|m|h, nonzero (`'60s'`, `'5m'`, `'1h'`). */
export function cronSeconds(every: string): number {
	const m = /^([1-9][0-9]*)(s|m|h)$/.exec(every)
	if (!m) return 0
	const n = parseInt(m[1], 10)
	const mult = m[2] === 's' ? 1 : m[2] === 'm' ? 60 : 3600
	return n * mult
}

/** Validate + collect `@[startup]`/`@[reroute]`/`@[error]`/`@[cron]` from `src/app.v`.
 * `@[startup]`: `() void|!void`, zero/one fn, no qualifier. `@[reroute]`:
 * `(host string, path string) string`, zero/one fn, no qualifier. `@[error]`:
 * `(message string, status int) string` (return '' = keep message, else
 * sanitized replacement), zero/one fn, no qualifier. `@[cron('60s'|'5m'|'1h')]`:
 * `() void|!void`, one-or-more fns, qualifier required and must be a duration
 * literal. Missing file → no-op hooks (byte-identical harness when absent).
 * No TS callable; `pub struct`s are NOT projected (Hand-level, not layout). */
export function loadServerHooks(root: string, srcDir = 'src'): ServerHooks {
	const file = join(root, srcDir, 'app.v')
	const legacy = join(root, srcDir, 'server.v')
	let src = ''
	try {
		src = readFileSync(file, 'utf8')
	} catch {
		if (existsSync(legacy))
			throw new Error(
				`[swelte] src/server.v was renamed to src/app.v — move it (generated .swelte/server.v keeps its name).`
			)
		return { hasFile: false, crons: [] }
	}
	const rel = `src/app.v`
	const fns = parseVFile(src)
	const out: ServerHooks = { hasFile: true, crons: [] }
	let startup: RpcFn | undefined
	let reroute: RpcFn | undefined
	let handleError: RpcFn | undefined
	for (const fn of fns) {
		if (fn.attr !== 'startup' && fn.attr !== 'reroute' && fn.attr !== 'cron' && fn.attr !== 'error')
			continue
		if (fn.attr === 'cron') {
			if (!fn.qualifier)
				throw new Error(
					`[swelte] ${rel}: @[cron] ${fn.name} needs a duration qualifier — @[cron('60s')] ('60s' | '5m' | '1h'), no cron-expr parser in v1.`
				)
			const seconds = cronSeconds(fn.qualifier)
			if (!seconds)
				throw new Error(
					`[swelte] ${rel}: @[cron] ${fn.name} has a bad duration ('${fn.qualifier}') — want digits + s|m|h, nonzero ('60s' | '5m' | '1h').`
				)
			if (fn.params.length !== 0)
				throw new Error(
					`[swelte] ${rel}: @[cron] ${fn.name} takes no params (got ${fn.params.length}).`
				)
			if (fn.vret !== 'void')
				throw new Error(
					`[swelte] ${rel}: @[cron] ${fn.name} must return void (got ${fn.vret || 'none'}).`
				)
			if (fn.hookBody === undefined)
				throw new Error(`[swelte] ${rel}: @[cron] ${fn.name} has no body to inline.`)
			if (out.crons.some((c) => c.every === fn.qualifier && c.body === fn.hookBody))
				throw new Error(
					`[swelte] ${rel}: duplicate @[cron('${fn.qualifier}')] body on ${fn.name} — one loop per fn.`
				)
			out.crons.push({
				every: fn.qualifier as string,
				seconds,
				body: fn.hookBody as string,
				fallible: fn.fallible,
			})
			continue
		}
		if (fn.qualifier)
			throw new Error(
				`[swelte] ${rel}: @[${fn.attr}] ${fn.name} takes no qualifier (one hook per kind).`
			)
		if (fn.attr === 'startup') {
			if (startup)
				throw new Error(
					`[swelte] ${rel}: two @[startup] fns (${startup.name} + ${fn.name}) — one startup hook per app.`
				)
			if (fn.params.length !== 0)
				throw new Error(
					`[swelte] ${rel}: @[startup] ${fn.name} takes no params (got ${fn.params.length}).`
				)
			if (fn.vret !== 'void')
				throw new Error(
					`[swelte] ${rel}: @[startup] ${fn.name} must return void (got ${fn.vret || 'none'}).`
				)
			startup = fn
		} else if (fn.attr === 'error') {
			if (handleError)
				throw new Error(
					`[swelte] ${rel}: two @[error] fns (${handleError.name} + ${fn.name}) — one error hook per app.`
				)
			if (fn.qualifier)
				throw new Error(
					`[swelte] ${rel}: @[error] ${fn.name} takes no qualifier (one hook per app).`
				)
			if (
				fn.params.length !== 2 ||
				fn.params[0].vtype !== 'string' ||
				fn.params[1].vtype !== 'int'
			) {
				throw new Error(
					`[swelte] ${rel}: @[error] ${fn.name} must take (message string, status int) (got (${fn.params.map((p) => p.vtype).join(', ')})).`
				)
			}
			if (fn.vret !== 'string')
				throw new Error(
					`[swelte] ${rel}: @[error] ${fn.name} must return string (sanitized message, '' = keep).`
				)
			handleError = fn
		} else {
			if (reroute)
				throw new Error(
					`[swelte] ${rel}: two @[reroute] fns (${reroute.name} + ${fn.name}) — one reroute hook per app.`
				)
			if (
				fn.params.length !== 2 ||
				fn.params[0].vtype !== 'string' ||
				fn.params[1].vtype !== 'string'
			)
				throw new Error(
					`[swelte] ${rel}: @[reroute] ${fn.name} must take (host string, path string) (got (${fn.params.map((p) => p.vtype).join(', ')})).`
				)
			if (fn.vret !== 'string')
				throw new Error(
					`[swelte] ${rel}: @[reroute] ${fn.name} must return string (rewritten path, '' = no-op).`
				)
			reroute = fn
		}
	}
	if (startup?.hookBody !== undefined) out.startupBody = startup.hookBody
	if (reroute?.hookBody !== undefined) out.rerouteBody = reroute.hookBody
	if (handleError?.hookBody !== undefined) out.errorBody = handleError.hookBody
	return out
}
