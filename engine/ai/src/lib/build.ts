import type { SwelteBuildPhase } from '@swelte/core/vite'
// Phase C: `@[tool]` manifest projection. Build-time only — reads parsed
// `@[tool]` fns (`RpcFn` with `singleArgsStruct`) plus the file's V structs
// and projects them into a versioned JSON-Schema manifest the backend
// dispatcher and the adapter's provider translation share. One identity per
// tool (`<file-mod>.<fn-name>/<schema-version>`); unsupported V wire types
// fail the build instead of degrading silently (same rule as the AI schema
// identity in `engine/ai`). No runtime deps — pure TS over parse output.
import { createHash } from 'node:crypto'
import type { RpcFn, VStruct } from '@swelte/core/vite'

export interface ToolManifestEntry {
	/** Manifest tool name: `<mod-path-dots>.<fn>` (e.g. `reports.top_pages`). */
	name: string
	/** True when declared `@[tool('side-effect')]` — needs backend approval. */
	sideEffect: boolean
	description: string
	inputSchema: Record<string, unknown>
	outputSchema: Record<string, unknown>
}

export interface ToolManifest {
	version: 1
	tools: ToolManifestEntry[]
}

/** V wire types the tool projection supports (docs/types.md surface:
 *  string/bool/ints/floats, []T, []u8→blob, map[string]T→record, time.Time→epoch,
 *  ?T optional. `json.Any`/`unknown` and named non-struct types fail. */
function fieldSchema(
	field: { name: string; vtype: string; tstype: string; optional: boolean },
	toolName: string,
	structName: string,
): Record<string, unknown> {
	const fail = (): never => {
		throw new Error(
			`[swelte] @[tool] ${toolName} field ${structName}.${field.name}: unsupported V type '${field.vtype}' — tools project string/bool/ints/floats/[]T/[]u8/map[string]T/time.Time/?T only.`
		)
	}
	if (field.tstype === 'unknown') fail()
	const t = field.vtype.trim().replace(/^\?/, '')
	const schemaFor = (vtype: string): Record<string, unknown> => {
		if (/^string$/.test(vtype)) return { type: 'string' }
		if (/^bool$/.test(vtype)) return { type: 'boolean' }
		if (
			/^(int|i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|f32|f64|float|fsize|byte|rune|time\.Duration)$/.test(
				vtype
			)
		)
			return { type: 'number' }
		if (/^time\.Time$/.test(vtype)) return { type: 'integer', format: 'epoch' }
		if (/^\[\]u8$/.test(vtype)) return { type: 'string', format: 'blob' }
		if (/^\[\]/.test(vtype)) return { type: 'array', items: schemaFor(vtype.slice(2)) }
		if (/^map\[string\]/.test(vtype)) {
			const inner = vtype.slice('map[string]'.length)
			if (inner === '') return { type: 'object' }
			return { type: 'object', additionalProperties: schemaFor(inner) }
		}
		return fail()
	}
	const inner = schemaFor(t)
	if (/^\?/.test(field.vtype.trim())) {
		// Nullable (?T) admits explicit null: JSON Schema union, not a
		// `nullable` keyword (draft-07 validators ignore `nullable`).
		const ty = (inner as Record<string, unknown>).type
		if (typeof ty === 'string') (inner as Record<string, unknown>).type = [ty, 'null']
	}
	return inner
}

function structSchema(
	toolName: string,
	structs: Map<string, VStruct>,
	structName: string,
	seen: Set<string>,
): Record<string, unknown> {
	const st = structs.get(structName)
	if (!st)
		throw new Error(
			`[swelte] @[tool] ${toolName}: args struct ${structName} not found in the same file.`
		)
	if (seen.has(structName))
		throw new Error(
			`[swelte] @[tool] ${toolName}: recursive struct ${structName} is not projectable.`
		)
	seen.add(structName)
	const properties: Record<string, unknown> = {}
	const required: string[] = []
	for (const f of st.fields) {
		// Inline nested same-file struct refs as nested objects — the TS
		// projection keeps them named, the tool input schema inlines them
		// so providers see plain JSON Schema.
		const refBase = f.vtype.trim().replace(/^\?/, '')
		const ref = structs.get(refBase.split('.').pop() as string)
		if (ref && !/^([]|map\[|\(|fn\s|chan\s)/.test(refBase) && /^[A-Za-z_]/.test(refBase)) {
			const nested = structSchema(toolName, structs, ref.name, seen)
			if (/^\?/.test(f.vtype.trim())) {
				const ty = (nested as Record<string, unknown>).type
				if (typeof ty === 'string') (nested as Record<string, unknown>).type = [ty, 'null']
			}
			properties[f.name] = nested
		} else {
			properties[f.name] = fieldSchema(f, toolName, structName)
		}
		if (!f.optional) required.push(f.name)
	}
	seen.delete(structName)
	return { type: 'object', properties, required, additionalProperties: false }
}

function outputSchemaFor(
	toolName: string,
	structs: Map<string, VStruct>,
	vret: string,
): Record<string, unknown> {
	const t = vret.trim().replace(/^!/, '')
	if (/^string$/.test(t)) return { type: 'string' }
	if (/^bool$/.test(t)) return { type: 'boolean' }
	if (/^(int|i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|f32|f64|float|fsize|byte|rune)$/.test(t))
		return { type: 'number' }
	// Reporting tools return row lists (`[]PageRow`): project the item type
	// and mark the array. Nested arrays are fine (same schemaFor recursion).
	if (/^\[\]/.test(t)) {
		const item = t.slice(2)
		// Each [] prefix adds exactly one layer: recurse on the item type.
		return { type: 'array', items: outputSchemaFor(toolName, structs, item) }
	}
	const st = structs.get(t.split('.').pop() as string)
	if (st) return structSchema(toolName, structs, st.name, new Set())
	throw new Error(
		`[swelte] @[tool] ${toolName}: unsupported return type '${vret}' — tools return string/bool/number or a same-file struct.`
	)
}


/** Short content hash (12 hex chars of SHA-256 over the canonical JSON).
 *  The schema `$id` embeds this hash, so a wire-contract change publishes a
 *  different identity instead of silently reusing the old one. */
export function schemaHash(schema: Record<string, unknown>): string {
	return createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 12)
}

/** Project `@[tool]` fns of one backend file into manifest entries.
 *  `mod` is the lib mod path (`backend/reports`); `docComments` maps fn
 *  names to their leading `//` doc text (empty string = undocumented). Schema
 *  `$id`s embed a content hash, so a wire change publishes a new identity. */
export function toolManifestFor(
	mod: string,
	fns: RpcFn[],
	structs: VStruct[],
	docComments: Record<string, string> = {},
): ToolManifestEntry[] {
	const byName = new Map(structs.map((s) => [s.name, s]))
	const dotted = mod.split('/').join('.')
	return fns
		.filter((f) => f.attr === 'tool')
		.map((fn) => {
			const name = `${dotted}.${fn.name}`
			const inputBody =
				fn.singleArgsStruct !== undefined
					? structSchema(fn.name, byName, fn.singleArgsStruct, new Set())
					: { type: 'object', properties: {}, required: [], additionalProperties: false }
			const outputBody = outputSchemaFor(fn.name, byName, fn.vret)
			const inputSchema = { ...inputBody, $id: `${name}/input/${schemaHash(inputBody)}` }
			const outputSchema = { ...outputBody, $id: `${name}/output/${schemaHash(outputBody)}` }
			return {
				name,
				sideEffect: fn.qualifier === 'side-effect',
				description: docComments[fn.name] ?? '',
				inputSchema,
				outputSchema,
			}
		})
}

/** Collect leading `//` doc lines directly above each `@[tool]` fn. */
export function toolDocComments(src: string): Record<string, string> {
	const lines = src.split('\n')
	const docs: Record<string, string> = {}
	for (let i = 0; i < lines.length; i++) {
		if (!/^\s*@\[\s*tool\b/.test(lines[i])) continue
		const buf: string[] = []
		for (let j = i - 1; j >= 0; j--) {
			const t = lines[j].trim()
			if (t.startsWith('//')) buf.unshift(t.replace(/^\/\/\s?/, ''))
			else if (t === '') break
			else break
		}
		let k = i + 1
		for (; k < lines.length; k++) {
			const m = /pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(lines[k])
			if (m) {
				docs[m[1]] = buf.join('\n')
				break
			}
			if (lines[k].trim() !== '' && !lines[k].trim().startsWith('//')) break
		}
	}
	return docs
}

/** Emit the canonical `tool_manifest.json` body for one app. */
export function emitToolManifest(entries: ToolManifestEntry[]): string {
	const manifest: ToolManifest = { version: 1, tools: entries }
	return JSON.stringify(manifest, null, 2) + '\n'
}

/** Per-run tool selection: resolve the app's chosen subset against the
 *  manifest. Unknown names fail closed; the returned entries are the only
 *  tools the run may invoke (the dispatcher enforces the same set). */
export function selectTools(manifest: ToolManifest, names: string[]): ToolManifestEntry[] {
	const byName = new Map(manifest.tools.map((t) => [t.name, t]))
	return names.map((name) => {
		const entry = byName.get(name)
		if (!entry) {
			const known = manifest.tools.map((t) => t.name).join(', ') || '(no tools)'
			throw new Error(`[swelte] unknown tool: ${name} (available: ${known})`)
		}
		return entry
	})
}

/** Minimal JSON-Schema-subset validator for tool args/results (build-time
 *  shapes only: objects with typed properties, arrays, string/boolean/
 *  number/integer scalars, type unions with 'null', schema-valued
 *  additionalProperties for maps). Returns error strings; empty means valid.
 *  `undefined` is never a valid JSON value: an explicit `undefined` always
 *  fails (absent optional keys are skipped by the caller before recursing).
 *  The backend dispatcher runs the same check natively. */
export function validateAgainstSchema(schema: Record<string, unknown>, value: unknown): string[] {
	const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string]
	if (value === null) {
		return types.includes('null') ? [] : ['expected non-null value']
	}
	if (value === undefined) {
		return ['expected value, got undefined']
	}
	if (types.includes('array')) {
		if (!Array.isArray(value)) return ['expected array']
		const items = schema.items as Record<string, unknown> | undefined
		if (!items) return []
		const errs: string[] = []
		value.forEach((item, i) => {
			for (const e of validateAgainstSchema(items, item)) errs.push(`[${i}]: ${e}`)
		})
		return errs
	}
	if (types.includes('object')) {
		if (typeof value !== 'object' || Array.isArray(value)) return ['expected object']
		const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
		const required = (schema.required ?? []) as string[]
		const errs: string[] = []
		const obj = value as Record<string, unknown>
		for (const key of required) {
			if (!(key in obj) || obj[key] === undefined) errs.push(`missing required property: ${key}`)
		}
		const allowExtra = schema.additionalProperties
		for (const [key, prop] of Object.entries(props)) {
			if (!(key in obj) || obj[key] === undefined) continue
			for (const e of validateAgainstSchema(prop, obj[key])) errs.push(`${key}: ${e}`)
		}
		if (allowExtra === false) {
			for (const key of Object.keys(obj)) {
				if (!(key in props)) errs.push(`unexpected property: ${key}`)
			}
		} else if (typeof allowExtra === 'object' && allowExtra !== null) {
			// map[string]T: every undeclared key must validate against the
			// value schema (e.g. {"count":"many"} fails {type:'number'}).
			const valueSchema = allowExtra as Record<string, unknown>
			for (const key of Object.keys(obj)) {
				if (key in props || obj[key] === undefined) continue
				for (const e of validateAgainstSchema(valueSchema, obj[key])) errs.push(`${key}: ${e}`)
			}
		}
		return errs
	}
	const scalar = types.find((t) => t !== 'null') ?? 'null'
	if (scalar === 'string' && typeof value !== 'string') return ['expected string']
	if (scalar === 'boolean' && typeof value !== 'boolean') return ['expected boolean']
	if (scalar === 'number' && typeof value !== 'number') return ['expected number']
	if (scalar === 'integer' && (typeof value !== 'number' || !Number.isInteger(value)))
		return ['expected integer']
	return []
}

/** Emit the run-bindings module for one app's tools (plain JavaScript with
 *  JSDoc types — written as tools.gen.mjs and imported by the backend
 *  transport / tests; no TS syntax in the output).
 *
 *  Selection is bound into the callable interface: `createRunTools(names,
 *  transport)` returns an object carrying ONLY the selected tools. There
 *  are no per-tool top-level exports to bypass — an unselected tool has no
 *  function in the run's object, and `callSelectedTool` re-checks the
 *  selection before touching the transport. The native V dispatcher takes
 *  the same allowlist (`emitToolDispatcher`). */
export function emitToolBindings(entries: ToolManifestEntry[]): string {
	const out: string[] = [
		'// Auto-generated by swelte from @[tool] declarations. Do not edit.',
		'// Backend-only: per-run tool bindings. Selection is bound at creation:',
		'// the run object carries only the selected tools.',
		'',
		`export const TOOL_MANIFEST = ${JSON.stringify(entries)};`,
		'',
		'const byName = new Map(TOOL_MANIFEST.map((t) => [t.name, t]));',
		'',
		'/** @typedef {(name: string, args: unknown) => Promise<unknown>} ToolTransport */',
		'',
		'/** @param {Record<string, unknown>} schema @param {unknown} value @param {string} what */',
		'function check(schema, value, what) {',

		'\tconst errs = [];',
		'\tconst walk = (s, v, path) => {',
		'\t\tconst types = (Array.isArray(s.type) ? s.type : [s.type]);',
		'\t\tif (v === null) {',
		'\t\t\tif (!types.includes(\'null\')) errs.push(`${path}: expected non-null`);',
		'\t\t\treturn;',
		'\t\t}',
		'\t\tif (v === undefined) {',
		'\t\t\terrs.push(`${path}: expected value, got undefined`);',
		'\t\t\treturn;',
		'\t\t}',
		'\t\tif (types.includes(\'array\')) {',
		'\t\t\tif (!Array.isArray(v)) { errs.push(`${path}: expected array`); return; }',
		'\t\t\tconst items = s.items;',
		'\t\t\tif (items) v.forEach((item, i) => walk(items, item, `${path}[${i}]`));',
		'\t\t\treturn;',
		'\t\t}',
		'\t\tif (types.includes(\'object\')) {',
		'\t\t\tif (typeof v !== \'object\' || Array.isArray(v)) { errs.push(`${path}: expected object`); return; }',
		'\t\t\tconst o = v;',
		'\t\t\tfor (const key of (s.required ?? [])) {',
			'\t\t\t\tif (!(key in o) || o[key] === undefined) errs.push(`${path}: missing required property ${key}`);',
			'\t\t\t}',
			'\t\t\tconst props = (s.properties ?? {});',
			'\t\t\tfor (const [key, prop] of Object.entries(props)) {',
			'\t\t\t\tif (key in o && o[key] !== undefined) walk(prop, o[key], path ? `${path}.${key}` : key);',
			'\t\t\t}',
			'\t\t\tif (s.additionalProperties === false) {',
			'\t\t\t\tfor (const key of Object.keys(o)) {',
			'\t\t\t\t\tif (!(key in props)) errs.push(`${path}: unexpected property ${key}`);',
			'\t\t\t\t}',
			'\t\t\t} else if (typeof s.additionalProperties === \'object\' && s.additionalProperties !== null) {',
			'\t\t\t\tfor (const key of Object.keys(o)) {',
			'\t\t\t\t\tif (key in props || o[key] === undefined) continue;',
			'\t\t\t\t\twalk(s.additionalProperties, o[key], path ? `${path}.${key}` : key);',
			'\t\t\t\t}',
			'\t\t\t}',
		'\t\t\treturn;',
		'\t\t}',
		'\t\tconst scalar = types.find((t) => t !== \'null\') ?? \'null\';',
		'\t\tif (scalar === \'string\' && typeof v !== \'string\') errs.push(`${path}: expected string`);',
		'\t\tif (scalar === \'boolean\' && typeof v !== \'boolean\') errs.push(`${path}: expected boolean`);',
		'\t\tif (scalar === \'number\' && typeof v !== \'number\') errs.push(`${path}: expected number`);',
		'\t\tif (scalar === \'integer\' && (typeof v !== \'number\' || !Number.isInteger(v))) errs.push(`${path}: expected integer`);',
		'\t};',
		'\twalk(schema, value, what);',
		'\tif (errs.length) throw new Error(`invalid ${what}: ${errs.join(\'; \')}`);',
		'}',
		'',
	]
	out.push('export function createRunTools(selected, transport) {')
	out.push("	check({ type: 'array', items: { type: 'string' } }, selected, 'selected');")
	out.push('	const run = Object.create(null);')
	out.push('	for (const name of selected) {')
	out.push('		const entry = byName.get(name);')
	out.push('		if (!entry) throw new Error(`unknown tool: ${name}`);')
	out.push('		run[name] = args => invoke(entry, args, transport);')
	out.push('	}')
	out.push('	return run;')
	out.push('}')
	out.push('async function invoke(entry, args, transport) {')
	out.push("	check(entry.inputSchema, args, 'args');")
	out.push('	const result = await transport(entry.name, args);')
	out.push("	check(entry.outputSchema, result, 'result');")
	out.push('	return result;')
	out.push('}')
	out.push('/** Invoke a selected tool by manifest name (fails closed on unknown).')
	out.push(' * @param {ToolManifestEntry[]} selected @param {string} name @param {unknown} args @param {ToolTransport} transport */')
	out.push('export async function callSelectedTool(selected, name, args, transport) {')
	out.push(`\tif (!selected.some((t) => t.name === name)) throw new Error(\`tool not selected for this run: \${name}\`);`)
	out.push(`\tconst entry = byName.get(name);`)
	out.push(`\tif (!entry) throw new Error(\`unknown tool: \${name}\`);`)
	out.push('	return invoke(entry, args, transport);')
	out.push('}')
	out.push('')
	return out.join('\n')
}

/** Emit the native V dispatcher for one app's tools. Staged into the
 *  `.swelte/` compilation unit (module `tools`). Each entry carries its
 *  staged dir (`backend` or `backend/reports`); the dispatcher imports
 *  each dir once (`import backend`, `import backend.reports`) and qualifies
 *  every call with its own dir module (`backend.top_pages`,
 *  `reports.list`), so tools in sibling backend dirs coexist. Tool files
 *  share one V module per staged dir (the `backend/` convention).
 *
 *  Per-run selection is enforced at this boundary: `allowed` is the run's
 *  tool-name subset and a name outside it fails before any V fn runs.
 *  `swelte_tool_dispatch(allowed, name, args_json)` decodes args, calls
 *  the V fn, encodes the result; unknown tools, unselected tools and bad
 *  args fail closed. Approval is enforced by the caller (the QuickJS host
 *  / route backend checks the manifest `sideEffect` flag + the approval
 *  record before dispatching). */
export interface ToolDispatchTarget {
	fn: string
	argsStruct: string | null
	fallible: boolean
}

export interface ToolDispatchModule {
	/** Manifest mod path, e.g. `backend/reports`. */
	mod: string
	/** Staged dir, e.g. `backend` or `backend/reports`. */
	dir: string
	fns: ToolDispatchTarget[]
}

/** V import path for a staged dir (`backend` -> `backend`,
 *  `backend/reports` -> `backend.reports`). */
export function toolImportPath(dir: string): string {
	return dir.split('/').join('.')
}

export function emitToolDispatcher(modules: ToolDispatchModule[]): string {
	const out: string[] = [
		'// Auto-generated by swelte from @[tool] declarations. Do not edit.',
		'module tools',
		'',
		'import json',
	]
	const aliases = new Map<string, string>()
	for (const { dir } of modules) {
		if (aliases.has(dir)) continue
		const alias = `toolmod_${aliases.size}`
		aliases.set(dir, alias)
		out.push(`import ${toolImportPath(dir)} as ${alias}`)
	}
	out.push('')
	out.push('pub fn swelte_tool_dispatch(allowed []string, name string, args_json string) !string {')
	out.push(`\tif name !in allowed {`)
	out.push(`\t\treturn error('tool not selected for this run: ' + name)`)
	out.push(`\t}`)
	for (const m of modules) {
		const qual = aliases.get(m.dir)!
		for (const target of m.fns) {
			const dotted = `${m.mod.split('/').join('.')}.${target.fn}`
			out.push(`\tif name == '${dotted}' {`)
			if (target.argsStruct) {
				out.push(`\t\targs := json.decode(${qual}.${target.argsStruct}, args_json) or { return error('bad args for ${dotted}') }`)
				if (target.fallible) {
					out.push(`\t\tres := ${qual}.${target.fn}(args) or { return error(err.msg()) }`)
				} else {
					out.push(`\t\tres := ${qual}.${target.fn}(args)`)
				}
			} else {
				// The only valid zero-argument payload is an empty JSON object.
				out.push(`\t\tpayload := args_json.trim(' \\t\\r\\n')`)
				out.push(`\t\tif payload.len < 2 || !payload.starts_with('{') || !payload.ends_with('}') || payload[1..payload.len - 1].trim(' \\t\\r\\n') != '' {`)
				out.push(`\t\t\treturn error('bad args for ${dotted}: expected empty object')`)
				out.push(`\t\t}`)
				if (target.fallible) {
					out.push(`\t\tres := ${qual}.${target.fn}() or { return error(err.msg()) }`)
				} else {
					out.push(`\t\tres := ${qual}.${target.fn}()`)
				}
			}
			out.push(`\t\treturn json.encode(res)`)
			out.push(`\t}`)
		}
	}
	out.push(`\treturn error('unknown tool: ' + name)`)
	out.push('}')
	out.push('')
	return out.join('\n')
}

/** Tool shape (Phase C): `@[tool]` or `@[tool('side-effect')]` on an app fn in
 *  `src/lib/backend/`. Protocol-ignorant like `@[rpc]` — one args-struct (or
 *  zero params) in, typed JSON-able value out. No HTTP types, no qualifier
 *  other than the optional side-effect marker. Declarations generate the
 *  manifest + bindings + native dispatcher; the fn body runs on the backend. */
export function validateToolFn(rel: string, m: RpcFn): void {
	if (m.qualifier && m.qualifier !== 'side-effect')
		throw new Error(
			`[swelte] ${rel}: @[tool] ${m.name} takes no qualifier except 'side-effect' (got '${m.qualifier}').`
		)
	for (const p of m.params) {
		if (/^fn\s*\(/.test(p.vtype.trim()) || /^chan\s+/.test(p.vtype.trim()))
			throw new Error(
				`[swelte] ${rel}: @[tool] ${m.name} param ${p.name} is a closure/channel (${p.vtype}) — tools take JSON-able args only.`
			)
		if (p.vtype === 'SwelteRequest' || p.vtype === 'SwelteResponse')
			throw new Error(
				`[swelte] ${rel}: @[tool] ${m.name} param ${p.name} is ${p.vtype} — tools are protocol-ignorant (typed args only); use a verb for HTTP.`
			)
	}
	if (
		m.vret === 'SwelteResponse' ||
		m.vret === '[]u8' ||
		/^\(\s*int\s*,\s*string\s*\)$/.test(m.vret) ||
		m.vret === '' ||
		m.vret === 'void'
	)
		throw new Error(
			`[swelte] ${rel}: @[tool] ${m.name} returns ${m.vret || '(none)'} — tools return a typed JSON-able value (single-args-struct in, value out).`
		)
	// Params must be empty or the single-args-struct expansion (one struct
	// param declared in the same file). Bare multi-param fns have no struct
	// identity to project into the input schema.
	if (m.params.length > 0 && !m.singleArgsStruct)
		throw new Error(
			`[swelte] ${rel}: @[tool] ${m.name} takes ${m.params.length} params — tools take zero params or one args-struct declared in the same file.`
		)
}


const phase: SwelteBuildPhase = {
	attrs: ['tool'],
	module: 'tools',
	generate(files) {
		const entries: ToolManifestEntry[] = []
		const targets: ToolDispatchModule[] = []
		for (const file of files) {
			const { mod, source, declarations, structs } = file
			if (file.kind !== 'backend')
				throw new Error(`[swelte:ai] ${file.path}: @[tool] requires a backend V module`)
			const dir = mod.includes('/') ? mod.slice(0, mod.lastIndexOf('/')) : mod
			const moduleName = dir.split('/').pop()
			if (source.match(/^\s*module\s+(\w+)/m)?.[1] !== moduleName)
				throw new Error(`[swelte:ai] ${file.path}: expected module ${moduleName}`)
			for (const fn of declarations) validateToolFn(file.path, fn)
			entries.push(...toolManifestFor(mod, declarations, structs, toolDocComments(source)))
			targets.push({ mod, dir, fns: declarations.map(fn => ({
				fn: fn.name, argsStruct: fn.singleArgsStruct ?? null, fallible: fn.fallible,
			})) })
		}
		return {
			'tool_manifest.json': emitToolManifest(entries),
			'tools.gen.mjs': emitToolBindings(entries),
			'tools.gen.v': emitToolDispatcher(targets),
		}
	},
}
export default phase
