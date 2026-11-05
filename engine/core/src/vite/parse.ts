import type { RpcFn, RpcParam, VStruct } from './types.js'

function splitTopLevel(s: string, sep: string): string[] {
	const out: string[] = []
	let depth = 0
	let cur = ''
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (c === '[' || c === '(' || c === '{' || c === '<') depth++
		if (c === ']' || c === ')' || c === '}' || c === '>') depth--
		if (c === sep && depth === 0) {
			out.push(cur)
			cur = ''
		} else cur += c
	}
	if (cur.trim() !== '' || out.length > 0) out.push(cur)
	return out
}

/** Core attrs parsed without plugins. Plugins extend via `extraAttrs`
 *  (e.g. `@swelte/plus/jobs` registers `cron`) — core itself names no
 *  plugin attr. Unknown attrs stay dropped unless registered here. */
export const CORE_ATTRS = [
	'get',
	'post',
	'rpc',
	'put',
	'delete',
	'patch',
	'sse',
	'ws',
	'before',
	'after',
	'load',
	'matcher',
	'startup',
	'reroute',
	'error',
] as const

export function parseVFile(src: string, extraAttrs: string[] = []): RpcFn[] {
	const structs = parseStructs(src)
	const structByName = new Map(structs.map((s) => [s.name, s]))
	const fns: RpcFn[] = []
	// V allows stacked attributes on consecutive lines (`@[rpc]` newline
	// `@[sets_cookie]` newline `pub fn`). The function regex below matches
	// the LAST bracket group before `pub fn`, so a stacked group would be
	// missed. Merge first: collapse `]` newline `@[` runs where the
	// in-between text is blank or a non-attribute comment into `; ` so
	// stacked groups parse as one.
	// Full-line comments that THEMSELVES contain an attribute break the
	// stack: a `// @[sse]` comment over a real `@[get]` must not fan out
	// to sse+get on one fn (the old `\]\s*\n\s*@\[` merge glued the
	// comment's trailing `]` to the real `@[`, and the fn regex then read
	// the fused group). Blank the gap line when it holds an attribute so
	// only `@[a]` gap `@[b]` and `@[a]` prose-comment `@[b]` merge.
	const mergeable = src
		.split('\n')
		.map((l) => (/^\s*\/\/\s*@\[/.test(l) ? '' : l))
		.join('\n')
	// Consume the second `@[` so `@[a]` NL `@[b]` fuses to `@[a; b]`,
	// exactly like the old `\]\s*\n\s*@\[` merge did for whitespace-only
	// gaps — minus the comment-line gluing it also permitted.
	const merged = mergeable.replace(/\][ \t]*\r?\n[ \t]*@\[/g, '; ')
	// Single-inline `@[sets_cookie]` outside the merged group still counts:
	// pre-scan for bare carrier lines immediately (whitespace-only span)
	// `@[sets_cookie]` was removed: cookies now live on SwelteResponse.cookies.
	// Any surviving annotation is a build error (no back-compat).
	const bareRe = /@\[\s*sets_cookie\s*\]/g
	let bm: RegExpExecArray | null
	while ((bm = bareRe.exec(merged)) !== null) {
		throw new Error(
			`[swelte] @[sets_cookie] was removed — return SwelteResponse{ cookies: [...] } instead.`
		)
	}
	const re = /@\[([^\]]*)\]\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
	let m: RegExpExecArray | null
	while ((m = re.exec(merged)) !== null) {
		// Paren-aware param scan: `emit fn (string) bool` contains
		// parens, so `([^)]*)` truncates. Walk balanced from the open
		// paren instead; the return type follows `)` up to `{`/`\n`.
		let depth = 1
		let i = m.index + m[0].length
		while (i < merged.length && depth > 0) {
			if (merged[i] === '(') depth++
			else if (merged[i] === ')') depth--
			i++
		}
		if (depth !== 0) continue
		const rawParamsFull = merged.slice(m.index + m[0].length, i - 1)
		const retMatch = /^\s*([?!]?(?:\([^)]*\)|[A-Za-z_\][\w.[\]]*|\[\]u8))?/.exec(
			merged.slice(i, i + 80)
		)
		const attrParts = splitTopLevel(m[1], ';')
		const verbs: { verb: string; qualifier?: string }[] = []
		for (const p of attrParts) {
			const pm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*'([^']*)'\s*\))?\s*$/.exec(p)
			if (pm && pm[1] === 'sets_cookie' && !pm[2]) {
				throw new Error(
					`[swelte] @[sets_cookie] was removed — return SwelteResponse{ cookies: [...] } instead.`
				)
			}
			if (pm && (CORE_ATTRS as readonly string[]).concat(extraAttrs).includes(pm[1])) {
				verbs.push({ verb: pm[1], qualifier: pm[2] })
			}
		}
		if (verbs.length === 0) {
			continue
		}
		const name = m[2]
		const rawParams = (rawParamsFull ?? '').trim()
		const rawRet = (retMatch?.[1] ?? '').trim()
		let params: RpcParam[] = []
		let singleArgsStruct: string | undefined
		const parts = rawParams === '' || rawParams === 'void' ? [] : splitTopLevel(rawParams, ',')
		// Single-args-struct convention: fn takes exactly one param whose type
		// is a struct declared in the same file → expand struct fields as params.
		// e.g. `pub fn login(args LoginArgs)` with `pub struct LoginArgs { payload string }`
		// behaves as TS `login(args: { payload: string })`.
		if (parts.length === 1) {
			const p = parts[0].trim().replace(/^(mut\s+|ref\s+)/, '')
			const pm =
				/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(p) ??
				/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(p)
			if (pm) {
				const vtype = pm[2].trim().replace(/^\?/, '')
				const st = structByName.get(vtype.split('.').pop() as string)
				if (st) {
					singleArgsStruct = st.name
					params = st.fields.map((f) => ({
						name: f.name,
						vtype: f.vtype,
						tstype: f.tstype,
						optional: f.optional,
					}))
				}
			}
		}
		if (!singleArgsStruct) {
			for (const part of parts) {
				const p = part.trim().replace(/^(mut\s+|ref\s+)/, '')
				if (!p) continue
				const pm =
					/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(p) ??
					/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(p)
				if (!pm) continue
				const vtype = pm[2].trim()
				params.push({ name: pm[1], vtype, tstype: tsTypeFor(vtype), optional: /^\?/.test(vtype) })
			}
		}
		let vret = rawRet
		let fallible = false
		if (vret.startsWith('!')) {
			fallible = true
			vret = vret.slice(1).trim() || 'void'
		}
		if (vret === '' || vret === 'void') vret = 'void'
		// Raw fn bodies for hook/app fns (transpiled/inlined at generate).
		// Brace-balanced walk from the `{` that opens the fn body. Bodies are
		// captured for matcher/core-hook attrs plus any plugin-registered attr
		// (extraAttrs), so owning plugins can inline them; core ignores
		// plugin-claimed fns everywhere else.
		let body: string | undefined
		let hookBody: string | undefined
		if (
			verbs.some(
				(vb) =>
					['matcher', 'startup', 'reroute', 'error'].includes(vb.verb) ||
					extraAttrs.includes(vb.verb)
			)
		) {
			const afterRet = i + (retMatch?.[0].length ?? 0)
			const openIdx = merged.indexOf('{', afterRet)
			if (openIdx >= 0) {
				let bdepth = 0
				let j = openIdx
				for (; j < merged.length; j++) {
					if (merged[j] === '{') bdepth++
					else if (merged[j] === '}') {
						bdepth--
						if (bdepth === 0) break
					}
				}
				if (bdepth === 0) {
					const inner = merged.slice(openIdx + 1, j)
					if (verbs.some((vb) => vb.verb === 'matcher')) body = inner
					else hookBody = inner
				}
			}
		}
		for (const vb of verbs) {
			fns.push({
				name,
				attr: vb.verb as RpcFn['attr'],
				qualifier: vb.qualifier,
				params,
				vret,
				tsret: tsTypeFor(vret),
				fallible,
				singleArgsStruct,
				...(body !== undefined ? { body } : {}),
				...(hookBody !== undefined ? { hookBody } : {}),
			})
		}
	}
	return fns
}

/** V → TS projection (single place both `parseVFile` and `parseStructs` use). */
export function tsTypeFor(vType: string): string {
	const t = vType.trim()
	if (t === 'SwelteRequest') return 'SwelteRequest'
	if (t === 'SwelteResponse') return 'SwelteResponse'
	// SSE emit callback + WS harness tails (harness-injected, never projected
	// as client args): `emit fn (string) bool` is structural, `sub` is the
	// room-subscribe closure, `recv` is the inbound channel.
	if (/^fn\s*\(\s*string\s*\)(\s*bool)?$/.test(t)) return '(event: string) => boolean'
	if (/^fn\s*\(\s*string\s*\)\s*chan\s+string$/.test(t)) return '(room: string) => unknown'
	if (/^chan\s+string$/.test(t)) return 'unknown'
	if (/^string$/.test(t)) return 'string'
	if (/^(bool)$/.test(t)) return 'boolean'
	if (
		/^(int|i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|f32|f64|float|fsize|byte|rune|time\.Duration)$/.test(
			t
		)
	)
		return 'number'
	if (/^time\.Time$/.test(t)) return 'number'
	if (t.startsWith('[]')) {
		if (/^\[\]u8$/.test(t)) return 'Blob'
		return `${tsTypeFor(t.slice(2))}[]`
	}
	if (t.startsWith('map[')) return 'Record<string, unknown>'
	if (t === 'json.Any' || t === 'json2.Any') return 'unknown'
	if (/^\(/.test(t)) {
		// Easy sugar: (int, string) -> { status, body }
		const m = /^\(\s*int\s*,\s*string\s*\)$/.exec(t)
		if (m) return 'SwelteResponse'
		return 'unknown'
	}
	if (/^\?/.test(t)) {
		const inner = tsTypeFor(t.slice(1))
		return inner === 'unknown' ? 'unknown' : `${inner} | null`
	}
	if (/^!/.test(t)) return tsTypeFor(t.slice(1))
	if (t === '' || t === 'void') return 'void'
	// Named V type (struct/enum/alias): project 1:1 to a TS interface with
	// the same name. Struct bodies are emitted by parseStructs below; types
	// not found in the same file stay as-is and resolve via imports later.
	if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t)) return t.split('.').pop() as string
	return 'unknown'
}

export function parseStructs(src: string): VStruct[] {
	const out: VStruct[] = []
	const re = /pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g
	let m: RegExpExecArray | null
	while ((m = re.exec(src)) !== null) {
		const name = m[1]
		const body = m[2]
		const fields: VStruct['fields'] = []
		for (const raw of body.split('\n')) {
			const line = raw.trim()
			if (
				!line ||
				line.startsWith('//') ||
				line.startsWith('pub:') ||
				line.startsWith('mut:') ||
				line === 'pub' ||
				line === 'mut'
			)
				continue
			const fm =
				/^([A-Za-z_][A-Za-z0-9_]*)\s+([?!]?[A-Za-z0-9_.[\]]+)(?:\s*=.*|\s+@[a-z_]+\s*.*)?$/.exec(
					line
				)
			if (!fm) continue
			const vtype = fm[2].trim()
			fields.push({ name: fm[1], vtype, tstype: tsTypeFor(vtype), optional: /^\?/.test(vtype) })
		}
		out.push({ name, fields })
	}
	return out
}

/** Narrow-args binding (roadmap section 8): verb fns not taking SwelteRequest
 * resolve each param by name from form-query-params (all strings on the
 * wire) and coerce to the V param type: ints via .int(), floats via .f64(),
 * bools via == true-string. `?T` optionals CANNOT inline `none` in a call
 * arg on V 0.5.2 (C backend emits `void[]`, cc rejects) — the call-site
 * builder below hoists them into `mut swelte_opt_N := ?T(none)` temps.
 * Returns per-param { raw, expr, optType }: raw is the string lookup, expr
 * the coerced value expression, optType the `?T` when optional. */
export function narrowArgParts(p: { name: string; vtype: string }): {
	raw: string
	expr: string
	optType: string | null
} {
	const raw = `req.form['${p.name}'] or { req.query['${p.name}'] or { req.params['${p.name}'] or { '' } } }`
	const t = p.vtype.trim()
	if (t.startsWith('?')) {
		const inner = narrowArgParts({ name: p.name, vtype: t.slice(1) })
		return { raw, expr: inner.expr, optType: t }
	}
	if (/^(int|i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|byte|rune)$/.test(t))
		return { raw, expr: `(${raw}).int()`, optType: null }
	if (/^(f32|f64|float|fsize)$/.test(t)) return { raw, expr: `(${raw}).f64()`, optType: null }
	if (/^bool$/.test(t)) return { raw, expr: `(${raw}) == 'true'`, optType: null }
	return { raw, expr: raw, optType: null }
}

/** Build a narrow-args call: `stmts` hoists `?T` temps (V 0.5.2 needs
 * `mut v_N := ?T(none)` + conditional assign — inline `none` in an arg
 * miscompiles), `call` is the `fn(a0, a1, ...)` expression. */
export function narrowCall(
	fnName: string,
	params: { name: string; vtype: string }[]
): {
	stmts: string[]
	call: string
} {
	const stmts: string[] = []
	const args = params.map((p, i) => {
		const part = narrowArgParts(p)
		if (part.optType === null) return part.expr
		const tmp = `swelte_opt_${i}`
		stmts.push(`mut ${tmp} := ${part.optType}(none)`)
		stmts.push(`if ${part.raw} != '' { ${tmp} = ${part.expr} }`)
		return tmp
	})
	return { stmts, call: `${fnName}(${args.join(', ')})` }
}

export function pascal(s: string): string {
	return s
		.split('_')
		.map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
		.join('')
}
