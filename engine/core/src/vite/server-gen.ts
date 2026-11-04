import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { list } from './fs.js'
import { narrowCall, parseStructs } from './parse.js'
import { vPrefix } from './routes.js'
import type { LoadFn, MatcherDef, RouteLimits, RpcFn, WrapperMw } from './types.js'

export function doubleClaimCheck(
	routesAbs: string,
	routesDir: string,
	mod: string,
	rel: string
): void {
	const dirOf = (m: string) => (m.includes('/') ? m.slice(0, m.lastIndexOf('/')) : '')
	const baseOf = (m: string) => (m.includes('/') ? m.slice(m.lastIndexOf('/') + 1) : m)
	const d = dirOf(mod)
	const b = baseOf(mod)
	const inDir = (bm: string) => (d === '' ? bm : `${d}/${bm}`)
	const pairs: string[][] = []
	if (b === 'index' || b === '+page') {
		const other = b === 'index' ? '+page' : 'index'
		pairs.push([`${inDir(other)}.v`, `${inDir(other)}.svelte`])
		if (d !== '') pairs.push([`${d}.v`, `${d}.svelte`])
	} else {
		pairs.push([`${inDir('index')}.v`, `${inDir('index')}.svelte`])
		pairs.push([`${inDir('+page')}.v`, `${inDir('+page')}.svelte`])
	}
	const others: string[] = []
	const selfV = `${mod}.v`
	const selfSvelte = `${mod}.svelte`
	for (const pr of pairs) {
		const v = pr[0]
		const st = pr[1]
		// Either extension on either side counts, unconditionally:
		// a `.v`-less `foo.svelte` still owns the URL and collides
		// with a `foo/+page.v` leaf. Exclude only self's own files.
		if (v !== selfV && existsSync(join(routesAbs, v))) others.push(`${routesDir}/${v}`)
		if (`${routesDir}/${st}` !== `${routesDir}/${selfSvelte}` && existsSync(join(routesAbs, st))) {
			others.push(`${routesDir}/${st}`)
		}
	}
	if (others.length > 0) {
		throw new Error(
			`[swelte] ${routesDir}/${rel} claims the same URL as ${others.join(' + ')} — one file per URL (guarded URLs live inside their guard's directory; keep the +page leaf).`
		)
	}
}

/** Middleware shapes (§7). */
export function validateMiddlewareFn(rel: string, m: RpcFn): void {
	if (m.qualifier)
		throw new Error(
			`[swelte] ${rel}: @[${m.attr}] ${m.name} takes no qualifier (wrappers run for the whole subtree, not one ?q).`
		)
	if (m.attr === 'before') {
		if (m.params.length !== 1 || m.params[0].vtype !== 'SwelteRequest')
			throw new Error(
				`[swelte] ${rel}: @[before] ${m.name} must take exactly one SwelteRequest param.`
			)
		if (m.vret !== 'SwelteRequest' || !m.fallible)
			throw new Error(`[swelte] ${rel}: @[before] ${m.name} must return !SwelteRequest.`)
	} else {
		const pv = m.params.map((pp) => pp.vtype)
		if (pv.length !== 2 || pv[0] !== 'SwelteRequest' || pv[1] !== 'SwelteResponse')
			throw new Error(
				`[swelte] ${rel}: @[after] ${m.name} must take (SwelteRequest, SwelteResponse).`
			)
		if (m.vret !== 'SwelteResponse' || !m.fallible)
			throw new Error(
				`[swelte] ${rel}: @[after] ${m.name} must return !SwelteResponse (got ${m.fallible ? '!' : ''}${m.vret || 'none'}).`
			)
	}
}

/** RPC shape: protocol-ignorant typed call. One args-struct in,
 * typed value out (or throw → TS reject). No HTTP types allowed:
 * no SwelteRequest/SwelteResponse params, no SwelteResponse/[]u8/(int,string)
 * returns — those are verb (HTTP) shapes. Runs in #routes/ (fetch) and
 * #lib/ (local WASM) identically. */
export function validateRpcFn(rel: string, m: RpcFn): void {
	if (m.qualifier)
		throw new Error(
			`[swelte] ${rel}: @[rpc] ${m.name} takes no qualifier (rpc is a named fn, not an HTTP verb).`
		)
	for (const p of m.params) {
		if (p.vtype === 'SwelteRequest' || p.vtype === 'SwelteResponse')
			throw new Error(
				`[swelte] ${rel}: @[rpc] ${m.name} param ${p.name} is ${p.vtype} — rpc is protocol-ignorant (typed args only); use a verb for HTTP.`
			)
	}
	if (
		m.vret === 'SwelteResponse' ||
		m.vret === '[]u8' ||
		/^\(\s*int\s*,\s*string\s*\)$/.test(m.vret)
	)
		throw new Error(
			`[swelte] ${rel}: @[rpc] ${m.name} returns ${m.vret || '(none)'} — rpc returns typed values (throw on error); use a verb for HTTP responses.`
		)
}

/** Verb shape: HTTP endpoint. Either `(SwelteRequest)` (+ optional narrow
 * params) or a bare/narrow signature, returning `string`/struct (JSON),
 * `[]u8` (binary), `(int, string)` (status+text), or `SwelteResponse`
 * (full control). `@[rpc]`-style free-form typed returns without the
 * request stay on `@[rpc]` — verbs without `SwelteRequest` must still be
 * HTTP-typed (one of the four). */
export function validateVerbFn(rel: string, m: RpcFn): void {
	if (
		m.vret !== 'SwelteResponse' &&
		m.vret !== '[]u8' &&
		!/^(string|[A-Z][A-Za-z0-9_]*|void)$/.test(m.vret) &&
		!/^\(\s*int\s*,\s*string\s*\)$/.test(m.vret) &&
		m.vret !== 'unknown'
	)
		throw new Error(
			`[swelte] ${rel}: @[${m.attr}] ${m.name} returns ${m.vret || '(none)'} — verbs are HTTP (string/struct/[]u8/(int,string)/SwelteResponse); use @[rpc] for typed calls.`
		)
}

/** Loader shape: `@[load] name(req SwelteRequest[, parent T]) !R`.
 * Level 0 (no ancestor load): exactly one param (SwelteRequest).
 * Deeper levels: `(SwelteRequest, parent T)` where T is the previous
 * level's return struct (prefixed name, same merged file — no import).
 * Mismatch → build error (the layout contract, enforced).
 * Returns the page-data value for this level — any JSON-able V value.
 * No qualifier (loaders run for the whole page, not one ?q).
 * Throw → +error props. */
export function validateLoadFn(rel: string, m: RpcFn, parentRet: string | null): void {
	if (m.qualifier)
		throw new Error(
			`[swelte] ${rel}: @[load] ${m.name} takes no qualifier (loaders run for the whole page, not one ?q).`
		)
	if (m.vret === '' || m.vret === 'unknown')
		throw new Error(
			`[swelte] ${rel}: @[load] ${m.name} must return a value (the level's page data).`
		)
	// P0 item 2: `SwelteLoadResult` opts the load into headers/cookies/status
	// (SvelteKit `load` setHeaders/cookies lite). The cascade encodes
	// `body` directly; intermediates thread it as `parent` unchanged.
	if (m.vret === 'SwelteLoadResult' && !m.fallible)
		throw new Error(
			`[swelte] ${rel}: @[load] ${m.name} returns SwelteLoadResult — it must stay fallible (!SwelteLoadResult; throw maps to +error).`
		)
	if (parentRet === null) {
		if (m.attr !== 'load')
			throw new Error(
				`[swelte] ${rel}: @[${m.attr}] ${m.name} is a verb/rpc handler, not a page loader — rename it (only @[load] fns join the cascade).`
			)

		if (m.params.length !== 1 || m.params[0].vtype !== 'SwelteRequest')
			throw new Error(
				`[swelte] ${rel}: @[load] ${m.name} is the first loader — it takes exactly one SwelteRequest param (no parent at root).`
			)
		return
	}
	if (m.params.length !== 2 || m.params[0].vtype !== 'SwelteRequest')
		throw new Error(
			`[swelte] ${rel}: @[load] ${m.name} must take (SwelteRequest, parent ${parentRet}) — parent is the previous level's value, already built.`
		)
	const got = m.params[1].vtype
	// Ancestor return may be written short (AdminLayout) or vType-
	// prefixed (AdminRoute_AdminLayout) — codegen merges both into one
	// file. Accept either spelling; the cascade calls under owning prefixes.
	const short = parentRet.includes('_') ? parentRet.split('_').pop()! : parentRet
	if (got !== parentRet && got !== short)
		throw new Error(
			`[swelte] ${rel}: @[load] ${m.name} parent is ${got}, want ${parentRet} (previous level's return — typed, already built).`
		)
}

/** Ancestor dirs root-first for a leaf URL dir (§7). */
export function ancestorDirs(leafDir: string): string[] {
	const segs = leafDir === '' ? [] : leafDir.split('/')
	const dirs: string[] = ['']
	for (let i = 0; i < segs.length; i++) dirs.push(segs.slice(0, i + 1).join('/'))
	return dirs
}

/** URL dir of a leaf mod (`admin/users` for the file serving /admin/users). */
export function leafDirOf(m: string): string {
	if (m === 'index' || m === '+page') return ''
	if (m.endsWith('/index')) return m.slice(0, -'/index'.length)
	if (m.endsWith('/+page')) return m.slice(0, -'/+page'.length)
	return m.includes('/') ? m.slice(0, m.lastIndexOf('/')) : ''
}

export function vJsonStr(s: string): string {
	return JSON.stringify(s)
}

export function vType(base: string, mod: string): string {
	const cap = mod
		.replace(/[^A-Za-z0-9_]/g, '_')
		.split('_')
		.filter(Boolean)
		.map((s) => s[0].toUpperCase() + s.slice(1))
		.join('')
	return `${cap}_${base}`
}

/** §7: inline wrapper middleware fn sources into the leaf file
 * (module routes, V needs one file: prefix by owning wrapper mod).
 * Only middleware fns: skip structs — the leaf struct pass handles
 * declarations; references resolve via vType. */
export function inlineWrapperFns(src: string, wmod: string, structNames: Set<string>): string[] {
	const wprefix = vPrefix(wmod)
	const out: string[] = []
	const lines = src.split('\n')
	let depth = 0
	let keep = false
	let buf: string[] = []
	const flush = () => {
		if (keep && buf.length > 0) {
			const hi = buf.findIndex((b) => /^(\s*)pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/.test(b))
			const fm = /^(\s*)pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(buf[hi < 0 ? 0 : hi] ?? '')
			if (fm) {
				buf[hi < 0 ? 0 : hi] =
					`${fm[1]}pub fn ${wprefix}${fm[2]}${(buf[hi < 0 ? 0 : hi]).slice(fm[0].length)}`
				for (let i = 0; i < buf.length; i++) {
					if (i === 0) {
						const t0 = buf[0].trim()
						if (/^(pub\s+)?struct\s/.test(t0)) continue
					}
					for (const sn of structNames) {
						buf[i] = buf[i].split(sn).join(vType(sn, wmod))
					}
				}
				for (const l of buf) out.push(l)
			}
		}
		buf = []
		keep = false
	}
	for (const line of lines) {
		const t = line.trim()
		if (depth === 0) {
			if (/^module\s+\S+/.test(t)) continue
			if (/^\s*import\s+/.test(line)) continue
			const fnHere = /^\s*(pub\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
			const attrHere = /@\[[^\]]*(before|after|load)/.test(line)
			const bareAttr = /^\s*@\[/.test(line) && !fnHere
			if (bareAttr) {
				buf.push(line)
				continue
			}
			if (fnHere) {
				keep = attrHere || buf.some((b) => /@\[[^\]]*(before|after|load)/.test(b))
				buf.push(line)
				depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
				if (depth <= 0) {
					depth = 0
					flush()
				}
				continue
			}
			if (/^\s*@\[/.test(line)) {
				buf.push(line)
				continue
			}
			if (/^\s*(pub\s+)?struct\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(line)) {
				depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
				continue
			}
			continue
		}
		buf.push(line)
		depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
		if (depth <= 0) {
			depth = 0
			flush()
		}
	}
	flush()
	return out
}

export function emitMatcherV(matcherDefs?: Map<string, MatcherDef>): string {
	const customs = [...(matcherDefs ?? new Map()).values()].filter((md) => md.name !== 'integer')
	const arms = customs
		.map((md) => `\tif matcher == '${md.name}' { return swelte_matcher_${md.name}(value) }`)
		.join('\n')
	const fns = customs
		.map(
			(md) =>
				`\nfn swelte_matcher_${md.name}(s string) bool {\n${md.vBody
					.split('\n')
					.map((l: string) => (l.trim() === '' ? '' : `\t${l}`))
					.join('\n')}\n}`
		)
		.join('\n')
	return `// [id=integer] constrains the segment to digits; the name still lands in
// params['id']. Unknown matchers never reach here — validateDynamicSegs
// rejects them at generate time. Custom bodies inline below (prefixed
// swelte_matcher_<name>), dispatched through swelte_matcher_check.
fn swelte_matcher_check(matcher string, value string) bool {
\tif matcher == 'integer' { return swelte_matcher_integer(value) }
${arms ? `${arms}\n` : ''}\treturn false
}

fn swelte_matcher_integer(s string) bool {
\tif s == '' { return false }
\tfor c in s.bytes() {
\t\tif c < 48 || c > 57 { return false }
\t}
\treturn true
}
${fns}`
}

export function emitServerGen(
	dispatched: { route: string; mod: string; prefix: string }[],
	sseMods: Set<string> = new Set(),
	matcherDefs?: Map<string, MatcherDef>,
	noSsrRoutes: string[] = [],
	noCsrRoutes: string[] = [],
	routeLimits: { route: string; limits: RouteLimits }[] = []
): string {
	/** Dynamic route arms (section 8): static beats dynamic; among dynamics,
	 * fewer [segs] first, [...rest] catch-all last (stable sort). */
	function dynSorted() {
		return dispatched
			.filter((x) => x.route.includes('['))
			.sort((a, b) => {
				const ca = a.route.includes('[...') ? 1 : 0
				const cb = b.route.includes('[...') ? 1 : 0
				if (ca !== cb) return ca - cb
				const pa = (a.route.match(/\[/g) || []).length
				const pb = (b.route.match(/\[/g) || []).length
				if (pa !== pb) return pa - pb
				return a.route < b.route ? -1 : a.route > b.route ? 1 : 0
			})
	}

	const o: string[] = [
		`// Auto-generated by swelte from V signatures. Do not edit.
module routes

import json
import net.urllib

fn swelte_unescape(s string) string {
return urllib.path_unescape(s) or { s }
}

fn swelte_forbidden() SwelteResponse {
return SwelteResponse{ status: 403, headers: {'Content-Type': 'application/json'}, body: '{"error":"forbidden"}' }
}

fn swelte_method_not_allowed() SwelteResponse {
return SwelteResponse{ status: 405, headers: {'Content-Type': 'application/json'}, body: '{"error":"method not allowed"}' }
}

fn swelte_err_unknown(path string, fn_name string, available []string) SwelteResponse {
mut avail := '['
for i, a in available {
	if i > 0 { avail += ',' }
	avail += json.encode(a)
}
avail += ']'
return SwelteResponse{ status: 404, headers: {'Content-Type': 'application/json'}, body: '{"error":"unknown fn","fn":' + json.encode(fn_name) + ',"path":' + json.encode(path) + ',"available":' + avail + '}' }
}

fn swelte_method_gate(method string) SwelteResponse {
if method == 'POST' || method == 'PUT' || method == 'PATCH' || method == 'DELETE' { return swelte_forbidden() }
return swelte_method_not_allowed()
}

fn swelte_normalize_path(path string) string {
if path.len > 1 && path.ends_with('/') { return path[..path.len - 1] }
return path
}

// Item 7 request shape: SwelteRequest + cookie helpers.

`,
		`pub struct SwelteRequest {
pub mut:
query map[string]string
form map[string]string
files map[string]string
files_bytes map[string][]u8
raw_body []u8
headers map[string]string
cookies map[string]string
params map[string]string
// Item 7 locals: per-request server-side bag, threaded from
// before_request through middleware into verbs and loads.
locals map[string]string
method string
path string
qualifier string
}

// API response envelope. Hand translates this 1:1 into veb calls
// (ctx.res.set_status, set_custom_header, set_cookie, send_response_to_client).
// Routes never touch veb — they return data, Hand owns the transport.
pub struct SwelteCookie {
pub mut:
name string
value string
path string
max_age int
expires string
domain string
secure bool
http_only bool
same_site string
}

pub fn (c SwelteCookie) to_header() string {
mut s := c.name + '=' + c.value
if c.path != '' { s += '; Path=' + c.path }
if c.domain != '' { s += '; Domain=' + c.domain }
if c.max_age != 0 { s += '; Max-Age=' + c.max_age.str() }
if c.expires != '' { s += '; Expires=' + c.expires }
if c.secure { s += '; Secure' }
if c.http_only { s += '; HttpOnly' }
if c.same_site != '' { s += '; SameSite=' + c.same_site }
return s
}

pub struct SwelteResponse {
pub mut:
status int = 200
headers map[string]string
cookies []SwelteCookie
body string
body_bytes []u8
is_bytes bool
}

// Page-load result envelope (P0 item 2): value-only loads keep
// returning the page-data type directly; SwelteLoadResult opts the
// load into headers/cookies/status (SvelteKit load setHeaders/cookies
// lite). Throw stays the error path (to +error props with the status).
pub struct SwelteLoadResult {
pub mut:
status int = 200
headers map[string]string
cookies []SwelteCookie
body string
}

// Constructors (sugar over the struct literal).
pub fn swelte_text(body string) SwelteResponse {
return SwelteResponse{ status: 200, body: body }
}

pub fn swelte_json(body string) SwelteResponse {
return SwelteResponse{ status: 200, headers: {'Content-Type': 'application/json'}, body: body }
}

pub fn swelte_status(status int, body string) SwelteResponse {
return SwelteResponse{ status: status, body: body }
}

// P0 item 3: typed error with status preservation (SvelteKit error()
// lite). Throw swelte_error(404, 'not found') from a verb or load
// and the harness maps it to +error props with the status (instead
// of the old always-400 err.msg() contract). Plain string throws
// keep the 400 default. Redirects stay SwelteResponse (verbs) or
// the load envelope status 3xx + Location header.
pub struct SwelteError {
pub:
	status int = 500
	message string
}

pub fn swelte_error(status int, message string) SwelteError {
	st := if status < 400 { 500 } else { status }
	return SwelteError{ status: st, message: message }
}

pub fn swelte_bytes(data []u8, content_type string) SwelteResponse {
return SwelteResponse{ status: 200, headers: {'Content-Type': content_type}, body_bytes: data, is_bytes: true }
}

pub fn swelte_redirect(location string, status int) SwelteResponse {
st := if status == 0 { 303 } else { status }
return SwelteResponse{ status: st, headers: {'Location': location}, body: '' }
}

// Item 7 cookie helpers: read from the request map;
// writes append to the response cookie list.
fn swelte_cookie_get(req SwelteRequest, name string) string {
return req.cookies[name] or { '' }
}

// §1.5 server fetch wrapper (V-only, never projected to TS, never in WASM):
// @[load]/@[before] fns call sibling routes in-process via the
// dispatcher (no loopback socket, single-artifact preserved), with the
// caller Cookie/Authorization headers forwarded. Returns the sub-request
// status + body; Set-Cookie headers from the sub-response are merged into
// the out list so session flows survive internal fetches.
pub struct SwelteFetchOut {
pub mut:
status int
body string
headers map[string]string
}

fn swelte_fetch(req SwelteRequest, mut out []SwelteCookie, method string, path string, body string, content_type string, qualifier string) SwelteFetchOut {
mut fwd_headers := map[string]string{}
for k, v in req.headers {
	lk := k.to_lower()
	if lk == 'cookie' || lk == 'authorization' {
		fwd_headers[k] = v
	}
	if lk == 'x-user' {
		fwd_headers[k] = v
	}
}
mut path_part := path
mut query := map[string]string{}
if path.contains('?') {
	parts := path.split('?')
	path_part = parts[0]
	if parts.len > 1 {
		for kv in parts[1].split('&') {
			if kv == '' { continue }
			eq := kv.index('=') or { -1 }
			if eq < 0 { query[kv] = '' } else { query[kv[..eq]] = kv[eq + 1..] }
		}
	}
}
res := swelte_route(path_part, method, query, fwd_headers, req.cookies, req.locals, body, content_type, qualifier)
for c in res.cookies {
	out << c
}
mut merged := map[string]string{}
for k2, v2 in res.headers {
	merged[k2] = v2
}
return SwelteFetchOut{ status: res.status, body: res.body, headers: merged }
}

fn swelte_cookie_set(mut out []SwelteCookie, name string, value string) {
out << SwelteCookie{ name: name, value: value, path: '/', http_only: true, same_site: 'Lax' }
}

fn swelte_cookie_set_full(mut out []SwelteCookie, c SwelteCookie) {
out << c
}

fn swelte_cookie_delete(mut out []SwelteCookie, name string) {
out << SwelteCookie{ name: name, value: '', path: '/', max_age: 0 }
}

fn swelte_err_bad(path string, fn_name string, detail string) SwelteResponse {
return SwelteResponse{ status: 400, headers: {'Content-Type': 'application/json'}, body: '{"error":' + json.encode(detail) + ',"fn":' + json.encode(fn_name) + ',"path":' + json.encode(path) + '}' }
}

fn swelte_err_unknown_qual(path string, available []string) SwelteResponse {
mut avail := '['
for i, a in available {
	if i > 0 { avail += ',' }
	avail += json.encode(a)
}
avail += ']'
return SwelteResponse{ status: 404, headers: {'Content-Type': 'application/json'}, body: '{"error":"unknown qualifier","path":' + json.encode(path) + ',"available":' + avail + '}' }
}

`,
		emitMatcherV(matcherDefs),
		`// Dynamic-segment helpers: [id] -> (id, blank), [id=integer] -> (id, integer).
fn swelte_dyn_name(ps string) string {
if ps.contains('=') { return ps[1..ps.index('=') or { ps.len - 1 }] }
return ps[1..ps.len - 1]
}

fn swelte_dyn_matcher(ps string) string {
if ps.contains('=') { return ps[ps.index('=') or { 0 } + 1..ps.len - 1] }
return ''
}

fn swelte_dyn_check(ps string, value string) bool {
m := swelte_dyn_matcher(ps)
if m == '' { return true }
return swelte_matcher_check(m, value)
}
`,
		`
	// Route-table note: static exact arms first, then dynamics with fewer
	// [segs] first, [...rest] catch-all last (stable sort) — but a
// catch-all ONLY matches when no exact or narrower arm does
// (fallback, never a conflict).
// The matcher is greedy-but-ordered: caller order decides
// (exact, dynamic, catch-all); a zero-length rest (GET /files
// on /files/[...rest]) matches only when no /files leaf claimed
// the URL — static beats dynamic, so a coexisting files/+page.v
// wins its own root while the catch-all owns everything beneath.
// Per-extension independence: this table covers .v routes only;
// .svelte routes match separately in the client router (matchSegs
// in .swelte/routes.js) — files/+page.svelte owns HTML
// GET /files while files/[...rest].v owns JSON GET /files
// (rest is empty) with no conflict.
fn swelte_match_route(pattern string, path string) (bool, map[string]string) {
norm_path := swelte_normalize_path(path)
mut params := map[string]string{}
if pattern == '/' { if norm_path == '/' || norm_path == '' { return true, params } return false, params }
mut psegs := pattern.split("/")
mut segs := norm_path.split("/")
if psegs.len > 0 && psegs[0] == '' { psegs.delete(0) }
if segs.len > 0 && segs[0] == '' { segs.delete(0) }
if psegs.len > 0 && psegs.last().starts_with('[...') {
	name := psegs.last()[4..psegs.last().len - 1]
	if segs.len < psegs.len - 1 { return false, params }
	for i in 0 .. psegs.len - 1 {
		ps := psegs[i]
		if ps.starts_with('[') { if i < segs.len && !swelte_dyn_check(ps, segs[i]) { return false, params } params[swelte_dyn_name(ps)] = if i < segs.len { swelte_unescape(segs[i]) } else { '' } } else if i >= segs.len || ps != segs[i] { return false, params }
	}
	mut rest_parts := segs[psegs.len - 1..].clone()
	for ri, rp in rest_parts { rest_parts[ri] = swelte_unescape(rp) }
	params[name] = rest_parts.join("/")
	return true, params
}
// Item 2 optional last segment: matches with or without it.
if psegs.len > 0 && psegs.last().starts_with('[[') {
	name := psegs.last()[2..psegs.last().len - 2]
	base := psegs.len - 1
	if segs.len != base && segs.len != psegs.len { return false, params }
	for i in 0 .. base {
		ps := psegs[i]
		if ps.starts_with('[') { if segs[i] == '' { return false, params } if !swelte_dyn_check(ps, segs[i]) { return false, params } params[swelte_dyn_name(ps)] = swelte_unescape(segs[i]) } else if ps != segs[i] { return false, params }
	}
	if segs.len == psegs.len { params[name] = swelte_unescape(segs[base]) } else { params[name] = '' }
	return true, params
}
if psegs.len != segs.len { return false, params }
for i in 0 .. psegs.len {
	ps := psegs[i]
	if ps.starts_with('[') { if segs[i] == '' { return false, params } if !swelte_dyn_check(ps, segs[i]) { return false, params } params[swelte_dyn_name(ps)] = swelte_unescape(segs[i]) } else if ps != segs[i] { return false, params }
}
return true, params
}

pub fn swelte_route(path string, method string, query map[string]string, headers map[string]string, cookies map[string]string, locals map[string]string, body string, content_type string, qualifier string) SwelteResponse {
norm_path := swelte_normalize_path(path)`,
		...dispatched
			.filter((x) => !x.route.includes('['))
			.map(
				(d) =>
					`\tif norm_path == ${vJsonStr(d.route)} { return ${d.prefix}dispatch(norm_path, method, query, map[string]string{}, headers, cookies, locals, body, content_type, qualifier) }`
			),
		// Dynamic arms (section 8) after exact arms: static beats dynamic; among
		// dynamics, fewer [segs] first, [...rest] catch-all last (stable sort).
		...dynSorted().map(
			(d) =>
				`\t${d.prefix}matched, ${d.prefix}params := swelte_match_route(${vJsonStr(d.route)}, norm_path)
if ${d.prefix}matched { return ${d.prefix}dispatch(norm_path, method, query, ${d.prefix}params, headers, cookies, locals, body, content_type, qualifier) }`
		),
		`\treturn SwelteResponse{ status: 404, headers: {'Content-Type': 'application/json'}, body: '{"error":"not found"}' }
}
`,
		// SSE route predicate (§14, true streaming via veb).
		// `before_request` (which owns `ctx`) calls this FIRST: on a
		// GET+Accept match on an SSE route it takes over + streams and
		// never reaches dispatch. Returns the dispatch prefix for the
		// matched file (whose `sse_events` accessor yields the list),
		// or '' when this request is not an SSE stream.
		`pub fn swelte_sse_route(path string, method string, query map[string]string, headers map[string]string, qualifier string) (string, map[string]string) {
mut accept := headers['Accept'] or { headers['accept'] or { '' } }
if method != 'GET' || !accept.contains('text/event-stream') { return '', map[string]string{} }`,
		...(dispatched.some((d) => sseMods.has(d.mod))
			? [`\tnorm_path := swelte_normalize_path(path)`]
			: [`\t_ = path`, `\t_ = query`]),
		...dispatched
			.filter((x) => !x.route.includes('['))
			.filter((d) => sseMods.has(d.mod))
			.map(
				(d) =>
					`\tif norm_path == ${vJsonStr(d.route)} { return ${vJsonStr(d.prefix)}, map[string]string{} }`
			),
		...dynSorted()
			.filter((d) => sseMods.has(d.mod))
			.map(
				(d) =>
					`\t${d.prefix}matched, ${d.prefix}params := swelte_match_route(${vJsonStr(d.route)}, norm_path)
if ${d.prefix}matched { return ${vJsonStr(d.prefix)}, ${d.prefix}params }`
			),
		`\treturn '', map[string]string{}
}
`,
		// SSE events fan-out (§14): `before_request` resolves the route
		// to a dispatch prefix; this maps prefix → per-file accessor.
		// List mode returns the list; emit mode runs the fn with the
		// harness emitter. Qualifier pre-check is side-effect free
		// (emit fns run ONLY inside the writer, post-takeover).
		`pub fn swelte_sse_events_for(prefix string, qualifier string, req SwelteRequest) ![]string {`,
		...dispatched
			.filter((d) => sseMods.has(d.mod))
			.map(
				(d) =>
					`\tif prefix == ${vJsonStr(d.prefix)} { return ${d.prefix}sse_events(qualifier, req) }`
			),
		`\treturn error('no sse route for prefix: ' + prefix)
}

pub fn swelte_sse_is_emit(prefix string) bool {`,
		...dispatched
			.filter((d) => sseMods.has(d.mod))
			.map((d) => `\tif prefix == ${vJsonStr(d.prefix)} { return ${d.prefix}sse_is_emit() }`),
		`\treturn false
}

pub fn swelte_sse_check_qual(prefix string, qualifier string) ! {`,
		...dispatched
			.filter((d) => sseMods.has(d.mod))
			.map(
				(d) =>
					`\tif prefix == ${vJsonStr(d.prefix)} { ${d.prefix}sse_check_qual(qualifier) or { return err } return }`
			),
		`\treturn error('no sse route for prefix: ' + prefix)
}

pub fn swelte_sse_emit_for(prefix string, qualifier string, req SwelteRequest, emit fn (string) bool) ! {`,
		...dispatched
			.filter((d) => sseMods.has(d.mod))
			.map(
				(d) =>
					`\tif prefix == ${vJsonStr(d.prefix)} { ${d.prefix}sse_emit(qualifier, req, emit) or { return err } return }`
			),
		`\treturn error('no sse route for prefix: ' + prefix)
}
`,
		// Loader fan-out: `before_request` resolves the page route to a
		// dispatch prefix; this maps prefix → per-file `swelte_load`.
		// Any throw → error (caller maps to +error props). No loads
		// on the file → its `swelte_load` returns a default envelope.
		`pub fn swelte_load_for(prefix string, req SwelteRequest) !SwelteLoadResult {`,
		...dispatched.map(
			(d) => `\tif prefix == ${vJsonStr(d.prefix)} { return ${d.prefix}swelte_load(req) }`
		),
		`\treturn error('no load route for prefix: ' + prefix)
}
`,
		// Page-route resolver for the load path: path → (prefix, params),
		// same precedence as swelte_route (static-first, dynamics sorted).
		// Only non-api routes resolve (api/* never has page data).
		// Miss → ('', {}) so the harness falls back to '{}'/static.
		`pub fn swelte_load_route(path string) (string, map[string]string) {
\tnorm_path := swelte_normalize_path(path)`,
		...dispatched
			.filter((x) => !x.route.includes('[') && !x.route.startsWith('/api/'))
			.map(
				(d) =>
					`\tif norm_path == ${vJsonStr(d.route)} { return ${vJsonStr(d.prefix)}, map[string]string{} }`
			),
		...dynSorted()
			.filter((d) => !d.route.startsWith('/api/'))
			.map(
				(d) =>
					`\t${d.prefix}matched, ${d.prefix}params := swelte_match_route(${vJsonStr(d.route)}, norm_path)
\tif ${d.prefix}matched { return ${vJsonStr(d.prefix)}, ${d.prefix}params }`
			),
		`\treturn '', map[string]string{}
}
`,
		// ssr=false-lite: Hand skips QJS/sidecar per route (export const ssr = false),
		// serves the SPA shell; async universal loads stay client-only.
		`pub fn swelte_no_ssr(path string) bool {`,
		...(noSsrRoutes.length ? [`\tnorm_path := swelte_normalize_path(path)`] : [`\t_ = path`]),
		...noSsrRoutes.map((r) => r.includes('[') ? `\tif m, _ := swelte_match_route(${vJsonStr(r)}, norm_path); m { return true }` : `\tif norm_path == ${vJsonStr(r)} { return true }`),
		`\treturn false
}`,
		// csr=false-lite: Hand still serves the SSR HTML; the client router
		// no-ops the mount/hydrate for these routes (routes.js `csr: false`).
		// The predicate stays server-visible for logs/contracts.
		`pub fn swelte_no_csr(path string) bool {`,
		...(noCsrRoutes.length ? [`\tnorm_path := swelte_normalize_path(path)`] : [`\t_ = path`]),
		...noCsrRoutes.map((r) => r.includes('[') ? `\tif m, _ := swelte_match_route(${vJsonStr(r)}, norm_path); m { return true }` : `\tif norm_path == ${vJsonStr(r)} { return true }`),
		`\treturn false
}`,
		// Per-route limits table (P1 item 12 lite): longest-prefix match in
		// Hand picks rate/rateWindowMs/timeoutMs/bodyLimit overrides; empty
		// table = global env defaults everywhere.
		`pub struct SwelteRouteLimits {
	pub mut:
		route string
		rate int
		rate_window_ms int
		timeout_ms int
		body_limit int
}`,
		`pub fn swelte_route_limits() []SwelteRouteLimits {`,
		`\tmut out := []SwelteRouteLimits{}`,
		...routeLimits.map(
			(e) =>
				`\tout << SwelteRouteLimits{ route: ${vJsonStr(e.route)}, rate: ${e.limits.rate ?? 0}, rate_window_ms: ${e.limits.rateWindowMs ?? 0}, timeout_ms: ${e.limits.timeoutMs ?? 0}, body_limit: ${e.limits.bodyLimit ?? 0} }`
		),
		`\treturn out
}`,
	]
	return o.join('\n')
}

export function emitRouteFile(
	mod: string,
	route: string,
	prefix: string,
	src: string,
	fns: RpcFn[],
	chain: WrapperMw[],
	loads: LoadFn[]
): string {
	// Hoisted-source note: `generate()` + `load()` call the single
	// exported `routeFor`/`jsFetchFor`/`jsWasmFor` above (no closure copy).
	const needRpc = fns.some((f) => f.attr === 'rpc')
	// Real verbs (sse excluded): only these build a reqHead with the
	// multipart/form parser (net.http) and json.encode value arms.
	// SSE-only routes (ticks.v) use neither — V warns on unused imports.
	const verbFns = fns.filter(
		(f) =>
			f.attr === 'get' ||
			f.attr === 'post' ||
			f.attr === 'put' ||
			f.attr === 'delete' ||
			f.attr === 'patch'
	)
	const needHttp = verbFns.length > 0
	// json.encode sites in this file: rpc decode/encode arms, verb value
	// arms (non-void/non-envelope/non-bytes/non-tuple), load cascade leaf.
	// void/SwelteResponse/[]u8/tuple-only verbs skip the generic wrapper.
	const verbNeedsJson = (h: RpcFn): boolean => {
		if (/^\(\s*int\s*,\s*string\s*\)$/.test(h.vret)) return false
		return h.vret !== 'void' && h.vret !== 'SwelteResponse' && h.vret !== '[]u8'
	}
	const needJson = needRpc || loads.length > 0 || verbFns.some(verbNeedsJson)
	// Only what this file's dispatch branch uses: rpc -> json+json2,
	// verbs -> json+http. Never emit an unused import (V warns).
	const baseImports = [
		...(needJson ? ['import json'] : []),
		...(needRpc ? ['import x.json2'] : []),
		...(needHttp ? ['import net.http'] : []),
		'',
	]
	const seenImp = new Set<string>()
	for (const impsrc of [src, ...chain.map((w) => w.src)]) {
		for (const m of impsrc.matchAll(/^\s*import\s+(.+)$/gm)) {
			const imp = m[1].trim()
			const first = imp.split(/[\s,]/)[0]
			if (
				!imp ||
				first === 'routes' ||
				first === 'json' ||
				first === 'x.json2' ||
				first === 'net.http' ||
				seenImp.has(imp)
			)
				continue
			seenImp.add(imp)
		}
	}
	// No per-fn cookie emitters: cookies live on SwelteResponse.cookies.
	// Shared structs: prefix to avoid duplicate-definition collisions
	// when several per-file outputs share `module routes`.
	const structNames = new Set(parseStructs(src).map((s) => s.name))
	for (const w of chain) {
		for (const st of parseStructs(w.src)) structNames.add(st.name)
	}
	const wrapperLines = chain.flatMap((w) => inlineWrapperFns(w.src, w.wmod, structNames))
	// Wrapper struct decls: inlineWrapperFns skips them (fn-only inline),
	// so emit them here under the wrapper's prefixed name. Leaf decls
	// flow through srcLines below; skip any the leaf redefines.
	const leafStructs = new Set(parseStructs(src).map((s) => s.name))
	const wrapperStructDecls = chain.flatMap((w) =>
		parseStructs(w.src)
			.filter((st) => !leafStructs.has(st.name))
			.map(
				(st) =>
					`pub struct ${vType(st.name, w.wmod)} {\npub:\n${st.fields.map((f) => `\t${f.name} ${f.vtype}`).join('\n')}\n}`
			)
	)
	const srcLines = src.split('\n').flatMap((line) => {
		const t = line.trim()
		if (/^module\s+\S+/.test(t)) return []
		if (/^\s*import\s+/.test(line)) return []
		let out = line.replace(/^(\s*)pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/, `$1pub fn ${prefix}$2`)
		out = out.replace(
			/^(\s*)(pub\s+struct\s+)([A-Za-z_][A-Za-z0-9_]*)/,
			(_mm: string, sp: string, kw: string, nm: string) =>
				`${sp}${kw}${(structNames as Set<string>).has(nm) ? vType(nm, mod) : prefix + nm}`
		)
		out = out.replace(/^(\s*)struct\s+([A-Za-z_][A-Za-z0-9_]*)/, `$1struct ${prefix}$2`)
		for (const sn of structNames) {
			if (new RegExp(`^\\s*(pub\\s+)?struct\\s+${sn}\\b`).test(t)) continue
			out = out.replace(new RegExp(`\\b${sn}\\b`, 'g'), vType(sn, mod))
		}
		return [out]
	})
	const o: string[] = [
		`// Auto-generated by swelte from V signatures. Do not edit.
// Route: ${route} <- ${mod}.v
module routes
`,
		// Only what this file's dispatch branch uses: rpc -> json+json2,
		// verbs -> json+http. Never emit an unused import (V warns).
		...baseImports,
		...[...seenImp].map((imp) => `import ${imp}`),
		...(seenImp.size ? [''] : []),
		...wrapperLines,
		...(wrapperStructDecls.length ? ['', ...wrapperStructDecls] : []),
		'',
		...srcLines,
		'',
	]
	// §7: middleware chain for this leaf. No wrappers → the public
	// `dispatch` IS the verb/rpc body (byte-identical to today, via
	// dispatchBody with sharedReq=null). With wrappers → `dispatch`
	// runs @[before] root→leaf on a shared `swelte_req`, calls the
	// inner verbs body, then runs @[after] leaf→root on (code, body).
	const befores = chain.flatMap((w) =>
		w.mws.filter((mw) => mw.attr === 'before').map((mw) => `${vPrefix(w.wmod)}${mw.name}`)
	)
	const afters = chain.flatMap((w) =>
		w.mws.filter((mw) => mw.attr === 'after').map((mw) => `${vPrefix(w.wmod)}${mw.name}`)
	)
	const aftersLeafFirst = [...afters].reverse()
	const beforeCalls = list(befores, (b) => {
		const bn = b.includes('_') ? b.slice(b.lastIndexOf('_') + 1) : b
		return `\tswelte_req = ${b}(swelte_req) or { return swelte_err_bad(path, '${bn}', err.msg()) }\n`
	})
	const afterCalls = list(aftersLeafFirst, (a) => {
		const an = a.includes('_') ? a.slice(a.lastIndexOf('_') + 1) : a
		return `\tswelte_res = ${a}(swelte_req, swelte_res) or { return swelte_err_bad(path, '${an}', err.msg()) }\n`
	})
	if (befores.length === 0 && afters.length === 0) {
		return [
			...o,
			`pub fn ${prefix}dispatch(path string, method string, query map[string]string, params map[string]string, headers map[string]string, cookies map[string]string, locals map[string]string, body string, content_type string, qualifier string) SwelteResponse {`,
			dispatchBody(prefix, mod, fns, null),
			'',
			emitSseEvents(prefix, mod, fns),
			emitLoadCascade(prefix, loads),
		].join('\n')
	}
	return [
		...o,
		`pub fn ${prefix}dispatch(path string, method string, query map[string]string, params map[string]string, headers map[string]string, cookies map[string]string, locals map[string]string, body string, content_type string, qualifier string) SwelteResponse {
mut form_before := map[string]string{}
mut files_before := map[string]string{}
mut files_bytes_before := map[string][]u8{}
if content_type.contains('multipart/form-data') {
	mut boundary_before := ''
	for part in content_type.split(';') {
		p_before := part.trim_space()
		if p_before.starts_with('boundary=') { boundary_before = p_before.all_after('boundary=').trim('"') }
	}
	mut swelte_raw_before := map[string][]http.FileData{}
	if boundary_before != '' { form_before, swelte_raw_before = http.parse_multipart_form(body, boundary_before) }
	for k, fs in swelte_raw_before {
		mut swelte_names := []string{}
		mut swelte_data := []u8{}
		for f in fs { swelte_names << f.filename; swelte_data = f.data.bytes() }
		files_before[k] = swelte_names.join(';')
		files_bytes_before[k] = swelte_data
	}
} else if content_type.contains('application/x-www-form-urlencoded') || body != '' {
	form_before = http.parse_form(body)
}
mut swelte_req := SwelteRequest{ query: query, form: form_before, files: files_before, files_bytes: files_bytes_before, raw_body: body.bytes(), headers: headers, cookies: cookies, params: params, locals: locals, method: method, path: path, qualifier: qualifier }`,
		beforeCalls,
		`	mut swelte_res := ${prefix}dispatch_verbs(path, method, query, params, headers, cookies, body, content_type, qualifier, swelte_req)`,
		afterCalls,
		`\treturn swelte_res
}

fn ${prefix}dispatch_verbs(path string, method string, query map[string]string, params map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string, swelte_req SwelteRequest) SwelteResponse {`,
		// `req` outlives the method arm (assigned per-arm below, read by
		// handler calls): declare once at function scope. All params are
		// consumed downstream (reqHead arms rebuild `req` per verb), but
		// files with no body/query arms would warn — silence them all up
		// front (`_ =` marks intentional use in V, no runtime cost).
		`\t_ = path
_ = method
_ = query
_ = params
_ = headers
_ = cookies
_ = body
_ = content_type
_ = qualifier
mut req := swelte_req`,
		dispatchBody(prefix, mod, fns, 'swelte_req'),
		emitSseEvents(prefix, mod, fns),
		emitLoadCascade(prefix, loads),
	].join('\n')
}

/** SSE events accessor (§14, true streaming via veb). Per file with
 * `@[sse]` fns: `swelte_sse_events(qualifier, req)` returns the fn's
 * event list for the qualifier, or an error for unknown qualifiers /
 * fallible failures. `before_request` calls this (it owns `ctx`),
 * then streams via `swelte_serve_sse`. No body, no sentinel. */
export function emitSseEvents(prefix: string, _mod: string, fns: RpcFn[]): string {
	const sseFns = fns.filter((f) => f.attr === 'sse')
	if (!sseFns.length) return ''
	const quals = sseFns.filter((h) => h.qualifier).map((h) => vJsonStr(h.qualifier as string))
	const qualErr = `\treturn error('unknown qualifier: ' + qualifier + ' (available: [${quals.join(', ')}])')`
	const isEmitFn = (h: RpcFn): boolean => {
		const emitP = h.params.length > 0 ? h.params[h.params.length - 1] : null
		return emitP !== null && /^fn\s*\(\s*string\s*\)(\s*bool)?$/.test(emitP.vtype.trim())
	}
	const condFor = (h: RpcFn): string =>
		h.qualifier ? `qualifier == ${vJsonStr(h.qualifier)}` : `qualifier == ''`
	const verbCall = (h: RpcFn): { pre: string[]; call: string } => {
		const isReq = h.params.length === 1 && h.params[0].vtype === 'SwelteRequest'
		if (isReq) return { pre: [], call: `${prefix}${h.name}(req)` }
		const built = narrowCall(`${prefix}${h.name}`, h.params)
		return { pre: built.stmts, call: built.call }
	}
	const arm = (body: string, tail: string): string => (body ? `${body}\n${tail}` : tail)
	const eventsArms = list(
		sseFns.filter((h) => !isEmitFn(h)),
		(h) => {
			const vc = verbCall(h)
			const pre = vc.pre.map((st) => `\t\t${st}`).join('\n')
			const ret = h.fallible ? `\t\treturn ${vc.call} or { return err }` : `\t\treturn ${vc.call}`
			return `\tif ${condFor(h)} {\n${pre ? `${pre}\n` : ''}${ret}\n\t}`
		}
	)
	const checkArms = list(sseFns, (h) => `\tif ${condFor(h)} { return }`)
	const emitArms = list(
		sseFns.filter((h) => isEmitFn(h)),
		(h) => {
			const narrow = h.params.slice(0, -1)
			const isReq = narrow.length === 1 && narrow[0].vtype === 'SwelteRequest'
			const built = isReq ? null : narrowCall(`${prefix}${h.name}`, narrow)
			const callArgs = isReq ? `req, emit` : narrow.length ? `${built!.call}, emit` : `emit`
			const pre =
				built && built.stmts.length ? `${built.stmts.map((st) => `\t\t${st}`).join('\n')}\n` : ''
			const run = h.fallible
				? `\t\t${prefix}${h.name}(${callArgs}) or { return err }`
				: `\t\t${prefix}${h.name}(${callArgs})`
			return `\tif ${condFor(h)} {\n${pre}${run}\n\t\treturn\n\t}`
		}
	)
	return `
pub fn ${prefix}sse_events(qualifier string, req SwelteRequest) ![]string {
${arm(eventsArms, qualErr)}
}

pub fn ${prefix}sse_is_emit() bool {
\treturn ${sseFns.some((h) => isEmitFn(h))}
}

pub fn ${prefix}sse_check_qual(qualifier string) ! {
${arm(checkArms, qualErr)}
}

pub fn ${prefix}sse_emit(qualifier string, req SwelteRequest, emit fn (string) bool) ! {
${arm(emitArms, qualErr)}
}
`
}

/** Loader cascade: `swelte_load(req)` runs ancestor +route `@[load]`
 * fns root-first; each level returns its typed value (struct, map,
 * string, array — any JSON-able V type). The cascade threads values:
 * level N receives level N-1's return as `parent` (typed, already
 * built — no decode, no JSON in `.v` files). The leaf's return is
 * `json.encode`d once at the edge → page props.
 * No loads anywhere → `'{}'`. Any throw → error (caller maps to +error).
 * Each load is called under its OWNING file's prefix (wrappers are
 * inlined under the wrapper prefix — same as @[before]/@[after]). */
export function emitLoadCascade(prefix: string, loads: LoadFn[]): string {
	if (loads.length === 0)
		return `
pub fn ${prefix}swelte_load(req SwelteRequest) !SwelteLoadResult {
\treturn SwelteLoadResult{ body: '{}' }
}
`
	const fnPrefix = (l: LoadFn): string => vPrefix(l.mod)
	const chained = loads
		.map((l, i) =>
			i === 0
				? `\tmut frag_${i} := ${fnPrefix(l)}${l.name}(req) or { return err }`
				: `\tmut frag_${i} := ${fnPrefix(l)}${l.name}(req, frag_${i - 1}) or { return err }`
		)
		.join('\n')
	const leaf = loads.length - 1
	// Envelope-aware leaf (P0 item 2): `SwelteLoadResult` carries pre-encoded
	// `body` + status/headers/cookies — return it directly. Plain values are
	// wrapped once at the edge (`json.encode`) with a 200 default envelope.
	const tail =
		loads[leaf].vret === 'SwelteLoadResult'
			? `\treturn frag_${leaf}`
			: `\treturn SwelteLoadResult{ body: json.encode(frag_${leaf}) }`
	return `
pub fn ${prefix}swelte_load(req SwelteRequest) !SwelteLoadResult {
${chained}
${tail}
}
`
}

/** Extracted verb/rpc body (unchanged semantics — moved verbatim out
 * of emitRouteFile so both chained and unchained leaves share it).
 * `sharedReq`: §7 pre-chain request (already @[before]-filtered) —
 * verb branches reuse it instead of building their own; null =
 * build locally (byte-identical to the old inline code). */
export function dispatchBody(
	prefix: string,
	mod: string,
	fns: RpcFn[],
	sharedReq: string | null
): string {
	// Shared prelude + arms per transport: RPC decodes the JSON envelope once;
	// verbs branch per method arm. Each arm is a self-contained string —
	// no `o.push` scaffolding, joined once at the end like emitServerGen.
	const rpcFns = fns.filter((f) => f.attr === 'rpc')
	const sseFns = fns.filter((f) => f.attr === 'sse')
	// V multi-return shape: hoisted, visible to both rpcArm and wrapVerb.
	const isTupleRet = /^\(\s*int\s*,\s*string\s*\)$/
	const rpcArm = (fn: RpcFn): string => {
		const rs = fn.singleArgsStruct ? vType(fn.singleArgsStruct, mod) : null
		const dec = rs
			? `json.decode(${rs}, args_json) or { return swelte_err_bad(path, fn_name, 'bad args') }`
			: `args_json`
		const uid = `${prefix}${fn.name}_rpc`.replace(/[^A-Za-z0-9_]/g, '_')
		const call = `${prefix}${fn.name}(${dec})`
		const resExpr = 'res'
		const wrapRet = (expr: string): string => {
			if (fn.vret === 'void') return `swelte_json('{}')`
			if (fn.vret === 'SwelteResponse') return expr
			if (fn.vret === '[]u8') return `swelte_bytes(${expr}, 'application/octet-stream')`
			// Tuple arms bypass wrapRet (statement destructure in body below).
			return `swelte_json(json.encode(${expr}))`
		}
		// V multi-return: no tuple indexing (`(f()).0` is extra args on V 0.5.2)
		// and no IIFE (anon `fn ()` captures nothing). Plain-statement destructure.
		const tupleBody = (src: string): string =>
			`\t\t\ts_${uid}, b_${uid} := ${src}
\t\t\treturn swelte_status(s_${uid}, b_${uid})`
		const body = isTupleRet.test(fn.vret)
			? fn.fallible
				? `\t\t\tres := ${call} or { return swelte_err_bad(path, fn_name, err.msg()) }
${tupleBody(resExpr)}`
				: `${tupleBody(`(${call})`)}`
			: fn.fallible
				? `\t\t\tres := ${call} or { return swelte_err_bad(path, fn_name, err.msg()) }
\t\t\treturn ${wrapRet(resExpr)}`
				: fn.vret === 'void'
					? `\t\t\t${call}
		return swelte_json('{}')`
					: `\t\t\treturn ${wrapRet(`(${call})`)}`
		return `\t\tif fn_name == ${vJsonStr(fn.name)} {
${body}
	}`
	}
	const avail = `[${rpcFns.map((f) => vJsonStr(f.name)).join(', ')}]`
	const rpcHead = `\tif method == 'POST' && (content_type.contains('application/json') || content_type == '') {\n\t\tparsed := json2.decode[map[string]json2.Any](body) or {\n\t\t\treturn swelte_err_bad(path, '', 'bad json body')\n\t\t}\n\t\tfn_any := parsed['fn'] or {\n\t\t\treturn swelte_err_bad(path, '', 'missing fn')\n\t\t}\n\t\tfn_name := fn_any.str().trim('"')\n\t\targs_any := parsed['args'] or { json2.Any(json2.null) }\n\t\targs_json := json2.encode(args_any)`
	const rpcTail = `\t\tif fn_name == '' {\n\t\t\treturn swelte_err_bad(path, fn_name, 'missing fn')\n\t\t}\n\t\treturn swelte_err_unknown(path, fn_name, ${avail})\n\t}`
	const rpcBlock = rpcFns.length === 0 ? '' : [rpcHead, list(rpcFns, rpcArm), rpcTail].join('\n')
	// §7: @[after] runs on the outcome: @[before] failures never reach
	// the verbs body (they return 4xx from dispatch), so @[after]
	// only observes real verb outcomes — no error attr possible here.
	// §10: unknown method on an endpoint-less file is 405; mutating
	// verbs on an RPC-less path shape is 403 (CSRF-relevant: plain
	// cross-site forms can only send GET/POST, so POST here is safe).
	const methodGate: string =
		sharedReq == null ? `swelte_method_not_allowed()` : `swelte_method_gate(method)`
	// SSE (roadmap §14, true streaming via veb): GET-only. One
	// `@[sse]` fn per file (qualifier rules mirror verbs: default
	// or `('q')`, unique per file). The fn returns a LIST of event
	// payloads (`[]string`). The dispatch SSE arm does NOT emit a
	// body — instead `before_request` (which owns `ctx`) checks for
	// SSE intent FIRST via the generated `swelte_is_sse_route` +
	// per-file match, takes over the conn, and streams. Dispatch
	// stays pure (status/body/cookies) for the JSON watchdog path.
	// This arm only validates qualifiers for SSE routes so direct
	// dispatch calls still 404 unknown qualifiers correctly.
	const sseQuals = sseFns.filter((h) => h.qualifier).map((h) => h.qualifier as string)
	const sseCheck =
		sseQuals.length === 0
			? `\t\tif qualifier != '' { return swelte_err_unknown_qual(path, []) }`
			: `\t\tif qualifier != '' && qualifier !in [${sseQuals.map((q) => vJsonStr(q)).join(', ')}] { return swelte_err_unknown_qual(path, [${sseQuals.map((q) => vJsonStr(q)).join(', ')}]) }`
	const sseArm =
		sseFns.length === 0
			? ''
			: `	if method == 'GET' && headers['Accept'] or { headers['accept'] or { '' } }.contains('text/event-stream') {\n${sseCheck}\n\t\treturn swelte_err_bad(path, '', 'sse handled in before_request')\n\t}`
	// §13: with @[before] wrappers the request already exists
	// (pre-filtered `swelte_req`, parsed once in dispatch) — reuse
	// it directly, no second multipart parse. Unchained leaves
	// parse here (form/files declared only in that branch).
	const reqHead = (vb: string): string =>
		sharedReq != null
			? `\t\treq = ${sharedReq}\n\t\treq.method = '${vb.toUpperCase()}'`
			: `\t\tmut form := map[string]string{}\n\t\tmut files := map[string]string{}\n\t\tmut files_bytes := map[string][]u8{}\n\t\tif content_type.contains('multipart/form-data') {\n\t\t\tmut boundary := ''\n\t\t\tfor part in content_type.split(';') {\n\t\t\t\tp := part.trim_space()\n\t\t\t\tif p.starts_with('boundary=') { boundary = p.all_after('boundary=').trim('"') }\n\t\t\t}\n\t\t\tmut swelte_raw_files := map[string][]http.FileData{}\n\t\t\tif boundary != '' { form, swelte_raw_files = http.parse_multipart_form(body, boundary) }\n\t\t\tfor k, fs in swelte_raw_files {\n\t\t\t\tmut swelte_names := []string{}\n\t\t\t\tfor f in fs { swelte_names << f.filename; files_bytes[k] = f.data.bytes() }\n\t\t\t\tfiles[k] = swelte_names.join(';')\n\t\t}\n\t\t} else if content_type.contains('application/x-www-form-urlencoded') || body != '' {\n\t\t\tform = http.parse_form(body)\n\t\t}\n\t\tmut req := SwelteRequest{ query: query, form: form, files: files, files_bytes: files_bytes, raw_body: body.bytes(), headers: headers, cookies: cookies, params: params, locals: locals, method: '${vb.toUpperCase()}', path: path, qualifier: qualifier }`
	const verbArm = (vb: string): string => {
		const hs = fns.filter((f) => f.attr === vb)
		if (hs.length === 0) return ''
		const quals = hs.filter((h) => h.qualifier).map((h) => h.qualifier as string)
		const tail = quals.length
			? `\t\treturn swelte_err_unknown_qual(path, [${quals.map((q) => vJsonStr(q)).join(', ')}])`
			: `\t\treturn swelte_err_bad(path, '', 'missing qualifier')`
		// Item 8: HEAD auto-handling — a GET handler also answers HEAD.
		const methodCond =
			vb === 'get'
				? `	if method == 'GET' || method == 'HEAD' {`
				: `	if method == '${vb.toUpperCase()}' {`
		return [methodCond, reqHead(vb), list(hs, verbBranch), tail, `	}`].join('\n')
	}
	const wrapVerb = (expr: string, vret: string): string => {
		if (vret === 'void') return `swelte_json('{}')`
		if (vret === 'SwelteResponse') return expr
		if (vret === '[]u8') return `swelte_bytes(${expr}, 'application/octet-stream')`
		// Tuple arms bypass wrapVerb (statement destructure in verbBranch).
		return `swelte_json(json.encode(${expr}))`
	}
	const verbBranch = (h: RpcFn): string => {
		const cond = h.qualifier ? `qualifier == ${vJsonStr(h.qualifier)}` : `qualifier == ''`
		const isReq = h.params.length === 1 && h.params[0].vtype === 'SwelteRequest'
		const built = isReq ? null : narrowCall(`${prefix}${h.name}`, h.params)
		const call = isReq ? `${prefix}${h.name}(req)` : built!.call
		const stmts = list(built?.stmts ?? [], (st) => `\t\t\t${st}\n`)
		// Unique suffix per (verb, qualifier) arm — one destructure per tuple arm.
		// Plain statements (no IIFE: anon `fn ()` captures nothing, `req` undefined).
		const uid = `${prefix}${h.name}_${h.qualifier || 'default'}`.replace(/[^A-Za-z0-9_]/g, '_')
		const wrap = (expr: string): string => wrapVerb(expr, h.vret)
		const tupleStat = (src: string): string =>
			`\t\t\ts_${uid}, b_${uid} := ${src}
\t\t\treturn swelte_status(s_${uid}, b_${uid})`
		const body = isTupleRet.test(h.vret)
			? h.fallible
				? `\t\t\tres := ${call} or { return swelte_err_bad(path, ${vJsonStr(h.name)}, err.msg()) }
${tupleStat('res')}`
				: `${tupleStat(`(${call})`)}`
			: h.fallible
				? `\t\t\tres := ${call} or { return swelte_err_bad(path, ${vJsonStr(h.name)}, err.msg()) }
\t\t\treturn ${wrap('res')}`
				: h.vret === 'void'
					? `\t\t\t${call}\n\t\t\treturn swelte_json('{}')`
					: `\t\t\treturn ${wrap(`(${call})`)}`
		return `\t\tif ${cond} {\n${stmts}${body}\n\t\t}`
	}
	const tail =
		sharedReq == null && fns.some((f) => f.attr === 'get')
			? `\treturn swelte_method_not_allowed()`
			: `\treturn ${methodGate}`
	return [rpcBlock, sseArm, ...['get', 'post', 'put', 'delete', 'patch'].map(verbArm), tail, `}\n`]
		.filter((s) => s !== '')
		.join('\n')
}
