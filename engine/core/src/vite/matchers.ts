import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseVFile } from './parse.js'
import type { MatcherDef } from './types.js'

/** Route dynamic-segment pattern ([id] / [id=integer] / [...rest] / [[slug]]) — shared by
 * jsFetchFor stub codegen and runtime matching. Group 4 is the matcher name. */
export const dynSegPattern =
	/\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]|\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]|\[([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*)\]|\[([A-Za-z_][A-Za-z0-9_]*)\]/

/** Portable matcher subset (V → JS): `s` string in, bool out.
 * Allowed: `==`/`!=`/`&&`/`||`/`!`, `s.len`, `s[i]`/`s[..]` slices,
 * byte compares (`c < 48`), `for c in s.bytes()`, early `return
 * true/false`. Everything else → build error naming the construct. */
export function transpileMatcherBody(name: string, vBody: string): string {
	const lines = vBody.split('\n')
	const out: string[] = []
	const paramRe = /^[A-Za-z_][A-Za-z0-9_]*$/
	void paramRe
	for (const raw of lines) {
		const line = raw.trim()
		if (line === '' || line.startsWith('//')) continue
		// for c in s.bytes() {  →  for (const c of s) {
		// V iterates bytes; JS for..of over a string iterates UTF-16 units —
		// same for the ASCII matchers this subset targets.
		let m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+s\.bytes\(\)\s*\{\s*$/.exec(line)
		if (m) {
			if (m[1] === 's') throw new Error(`[swelte] @[matcher] ${name}: loop var shadows param 's'`)
			out.push(`for (const ${m[1]}_c of s) { const ${m[1]} = ${m[1]}_c.charCodeAt(0);`)
			continue
		}
		// if c < 48 || c > 57 { return false } → JS if (with byte var as number)
		m = /^(if|else if)\s+(.+)\{\s*$/.exec(line)
		if (m) {
			out.push(`${m[1]} (${transpileMatcherExpr(name, m[2])}) {`)
			continue
		}
		if (/^else\s*\{\s*$/.test(line)) {
			out.push('else {')
			continue
		}
		if (line === '}') {
			out.push('}')
			continue
		}
		m = /^return\s+(true|false)\s*$/.exec(line)
		if (m) {
			out.push(`return ${m[1]};`)
			continue
		}
		// s == 'x' / s != '' statement form (rare) — treat as return expr.
		throw new Error(
			`[swelte] @[matcher] ${name}: unsupported statement '${line}' (want: for c in s.bytes(), if/else, return true/false)`
		)
	}
	return out.join('\n')
}

function transpileMatcherExpr(name: string, expr: string): string {
	let e = expr.trim()
	// String literal guard: only comparisons against '...' allowed; the
	// transpiler rewrites operators, so reject anything outside the subset.
	if (/[;`]/.test(e))
		throw new Error(`[swelte] @[matcher] ${name}: unsupported expression '${expr}'`)
	// s.len → s.length, s[i] stays (charCode compare needs .charCodeAt — but
	// the `for c in s.bytes()` form covers iteration; index form `s[i]`
	// maps to s.charCodeAt(i)).
	e = e.replace(/\bs\.len\b/g, 's.length')
	// s[i] byte compare → s.charCodeAt(i) — only when compared to a number.
	e = e.replace(/\bs\[([^\]]+)\]/g, 's.charCodeAt($1)')
	// Bare loop var in a numeric compare is already a char code (see above).
	// Equality on strings stays verbatim.
	// Reject fn calls other than the approved shapes.
	const calls = [...e.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((mm) => mm[1])
	for (const c of calls) {
		if (c !== 'charCodeAt')
			throw new Error(`[swelte] @[matcher] ${name}: call '${c}(...)' not in the portable subset`)
	}
	// Reject identifiers outside {s, true, false, loop vars, numbers}.
	// (Loop vars are declared by the for-line; accept any single ident here
	// and let JS scope it — V validation already enforces the shape.)
	if (/[^A-Za-z0-9_+\-*/%<>=!&|().'"\s]/.test(e))
		throw new Error(`[swelte] @[matcher] ${name}: unsupported expression '${expr}'`)
	return e
}

/** Validate + collect `@[matcher]` fns from `src/matchers.v`.
 * Shape: `(s string) bool`, non-fallible, no qualifier, no blocked
 * imports in the file (`time`/`os`/`net`/`db`/`v`/`x` — WASM-safe).
 * Returns name → def (with integer builtin when the file is absent). */
export function loadMatchers(root: string, srcDir = 'src'): Map<string, MatcherDef> {
	const out = new Map<string, MatcherDef>()
	out.set('integer', {
		name: 'integer',
		vBody: 'integer builtin',
		jsBody: 'return /^[0-9]+$/.test(s);',
	})
	const file = join(root, srcDir, 'matchers.v')
	let src = ''
	try {
		src = readFileSync(file, 'utf8')
	} catch {
		return out
	}
	for (const m of src.matchAll(/^\s*import\s+(.+)$/gm)) {
		for (const part of m[1].split(',')) {
			const top = part.trim().split(/[\s.]/)[0]
			if (['time', 'os', 'net', 'db', 'v', 'x', 'wasm'].includes(top))
				throw new Error(
					`[swelte] src/matchers.v: import '${top}' poisons WASM — matchers stay portable (no time/os/net)`
				)
		}
	}
	const fns = parseVFile(src)
	const seen = new Set<string>()
	for (const fn of fns) {
		if (fn.attr !== 'matcher') continue
		const rel = `src/matchers.v`
		if (fn.qualifier)
			throw new Error(
				`[swelte] ${rel}: @[matcher] ${fn.name} takes no qualifier (one fn per matcher).`
			)
		if (fn.fallible)
			throw new Error(`[swelte] ${rel}: @[matcher] ${fn.name} must return bool (total — no !bool).`)
		if (fn.vret !== 'bool')
			throw new Error(
				`[swelte] ${rel}: @[matcher] ${fn.name} must return bool (got ${fn.vret || 'none'}).`
			)
		if (fn.params.length !== 1 || fn.params[0].vtype !== 'string')
			throw new Error(
				`[swelte] ${rel}: @[matcher] ${fn.name} must take exactly one string param (s string).`
			)
		if (seen.has(fn.name)) throw new Error(`[swelte] ${rel}: duplicate @[matcher] ${fn.name}`)
		seen.add(fn.name)
		if (fn.name === 'integer')
			throw new Error(`[swelte] ${rel}: 'integer' is builtin — rename ${fn.name}.`)
		if (fn.body === undefined)
			throw new Error(`[swelte] ${rel}: @[matcher] ${fn.name} has no body to transpile.`)
		out.set(fn.name, {
			name: fn.name,
			vBody: fn.body,
			jsBody: transpileMatcherBody(fn.name, fn.body),
		})
	}
	return out
}
