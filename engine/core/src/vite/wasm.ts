import { execFileSync as execVSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveV, toolchainEnv } from '../toolchain.js'
import { writeIfChanged } from './fs.js'
import { parseVFile } from './parse.js'
import { wasmParamKind, wasmReturnKind } from './stubs.js'

let vBin = ''

/** Portable subset for `v -b wasm -os browser` (V 0.5.2). V's `json`
 * module is C-backed and the wasm backend chokes on `strings`/`math`
 * (array `.len` lowering) and `crypto/*` (transitive `io` import).
 * `#lib/backend/` is exempt (never compiled to WASM). */
export const WASM_LIB_ALLOW = new Set(['math', 'strings', 'encoding', 'crypto', 'json', 'json2'])
export const WASM_KNOWN_BROKEN = new Set(['strings', 'math', 'crypto', 'json'])

export function wasmBlockedImports(src: string): string[] {
	const blocked: string[] = []
	for (const m of src.matchAll(/^\s*import\s+([^\n;]+)/gm)) {
		for (const part of m[1].split(',')) {
			const p = part.trim().replace(/^\(/, '').replace(/\)$/, '').trim()
			if (!p || p.startsWith('//')) continue
			const mod = p.split(/\s+/).pop() as string
			const top = mod.split('.')[0]
			if (top === 'main' || top === 'builtin' || top === '') continue
			if (
				top === 'os' ||
				top === 'net' ||
				top === 'db' ||
				top === 'time' ||
				top === 'v' ||
				top === 'wasm' ||
				top === 'x'
			) {
				blocked.push(mod)
				continue
			}
			if (!WASM_LIB_ALLOW.has(top) && !WASM_LIB_ALLOW.has(mod)) blocked.push(mod)
		}
	}
	return [...new Set(blocked)]
}

export function compileLibWasm(src: string, mod: string, outWasm: string, libRel: string): number {
	const fns = parseVFile(src).filter((x) => x.attr === 'rpc')
	for (const f of fns) {
		for (const p of f.params) {
			if (wasmParamKind(p.vtype) === null) {
				throw new Error(
					libRel +
						': ' +
						f.name +
						'(' +
						p.name +
						': ' +
						p.vtype +
						') cannot cross the WASM boundary'
				)
			}
		}
		if (f.fallible)
			throw new Error(
				libRel +
					': ' +
					f.name +
					' is fallible — the V wasm backend cannot compile !T/?T (compiler ICE)'
			)
		if (wasmReturnKind(f.vret) === null)
			throw new Error(`${libRel}: ${f.name} returns ${f.vret || '(unparsed)'}`)
	}
	const blocked = wasmBlockedImports(src)
	if (blocked.length > 0) throw new Error(`${libRel}: blocked import(s): ${blocked.join(', ')}`)
	const broken = [
		...new Set(
			[...src.matchAll(/^\s*import\s+([^\n;]+)/gm)]
				.flatMap((m) => m[1].split(','))
				.map((p) => p.trim().split(/\s+/).pop() as string)
				.map((mm) => mm.split('.')[0])
				.filter((top) => WASM_KNOWN_BROKEN.has(top))
		),
	]
	if (broken.length > 0)
		throw new Error(
			libRel +
				': uses known-broken wasm stdlib (' +
				broken.join(', ') +
				') — V 0.5.2 backend limitation'
		)
	const body = src
		.replace(/^\s*module\s+\S+.*$/m, 'module main')
		.replace(/@\[([^\]]*)\]\s*/g, (_mm, attrs: string) => {
			const keep = attrs
				.split(';')
				.map((a: string) => a.trim())
				.filter((a: string) => a && !/^(rpc|get|post|put|delete|patch|sse)\b/.test(a))
			return keep.length > 0 ? `@[${keep.join('; ')}] ` : ''
		})
	const compiled = [
		`module main

@[export: 'swelte_alloc']
pub fn swelte_alloc(n int) &u8 {
return unsafe { malloc(if n <= 0 { 1 } else { n }) }
}
`,
		...body.split('\n').filter((l) => !/^\s*module\s+\S+/.test(l)),
	].join('\n')
	mkdirSync(dirname(outWasm), { recursive: true })
	// Debug data lives next to the .wasm inside .swelte/ (gitignored,
	// never published): the exact compiled unit + a name map so
	// `explain_bytecode_error` can resolve wasm traps to .v source.
	// Per-module filename: generate() compiles modules sequentially
	// into one dir, a shared name would go stale.
	const stem = mod.split('/').pop() as string
	const keepV = join(dirname(outWasm), `${stem}.compile.v`)
	const mapFile = outWasm.replace(/\.wasm$/, '.wasm.map')
	writeIfChanged(keepV, compiled)
	if (!vBin) vBin = resolveV(import.meta.url)
	execVSync(vBin, ['-b', 'wasm', '-os', 'browser', '-o', outWasm, keepV], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: toolchainEnv(),
	})
	const size = statSync(outWasm).size
	writeIfChanged(
		mapFile,
		JSON.stringify(
			{
				mod,
				file: libRel,
				compiled: `${stem}.compile.v`,
				functions: fns.map((f) => ({ name: f.name, params: f.params.map((p) => p.name) })),
			},
			null,
			2
		)
	)
	return size
}
