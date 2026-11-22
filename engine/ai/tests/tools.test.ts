import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
import { parseStructs, parseVFile as parse } from '@swelte/core/vite'
const parseVFile = (source: string) => parse(source, ['tool'])
import { validateToolFn } from '../src/lib/build.js'
import {
	emitToolBindings,
	emitToolDispatcher,
	emitToolManifest,
	schemaHash,
	selectTools,
	toolDocComments,
	toolManifestFor,
	validateAgainstSchema,
	type ToolManifestEntry,
} from '../src/lib/build.js'

const SRC = `module reports

pub struct PageArgs {
pub:
	limit int
	query string
}

pub struct PageRow {
pub:
	title string
}

// Top pages by views.
@[tool]
pub fn top_pages(args PageArgs) ![]PageRow {
	return []PageRow{}
}

// Zero-arg health probe.
@[tool]
pub fn ping() string {
	return 'ok'
}

// Side-effecting publish.
@[tool('side-effect')]
pub fn publish(args PageArgs) string {
	return 'id'
}
`

describe('@[tool] parse + validate', () => {
	it('parses three tool fns with qualifiers', () => {
		const fns = parseVFile(SRC).filter((f) => f.attr === 'tool')
		assert.deepEqual(
			fns.map((f) => [f.name, f.qualifier ?? null]),
			[
				['top_pages', null],
				['ping', null],
				['publish', 'side-effect'],
			]
		)
	})

	it('validates the tool shape', () => {
		for (const fn of parseVFile(SRC).filter((f) => f.attr === 'tool')) {
			validateToolFn('src/lib/backend/reports.v', fn)
		}
	})

	it('rejects qualifiers other than side-effect', () => {
		const [fn] = parseVFile(`@[tool('nope')] pub fn f() string { return '' }`)
		assert.ok(fn)
		assert.throws(() => validateToolFn('x.v', fn), /except 'side-effect'/)
	})

	it('rejects multi-param fns without an args struct', () => {
		const [fn] = parseVFile(`@[tool] pub fn f(a string, b int) string { return '' }`)
		assert.ok(fn)
		assert.throws(() => validateToolFn('x.v', fn), /one args-struct/)
	})

	it('rejects SwelteRequest params and void returns', () => {
		const [req] = parseVFile(
			`@[tool] pub fn f(req SwelteRequest) string { return '' }`
		)
		assert.ok(req)
		assert.throws(() => validateToolFn('x.v', req), /protocol-ignorant/)
		const [novoid] = parseVFile(`@[tool] pub fn f() void {}`)
		assert.ok(novoid)
		assert.throws(() => validateToolFn('x.v', novoid), /typed JSON-able/)
	})
})

describe('@[tool] manifest projection', () => {
	it('projects input/output schemas with stable ids', () => {
		const fns = parseVFile(SRC)
		const entries = toolManifestFor('backend/reports', fns, parseStructs(SRC), toolDocComments(SRC))
		assert.equal(entries.length, 3)
		const top = entries.find((e) => e.name === 'backend.reports.top_pages')
		assert.ok(top)
		assert.equal(top.sideEffect, false)
		assert.ok(top.description.includes('Top pages'))
		const topIn = top.inputSchema as { $id: string }
		const topOut = top.outputSchema as { $id: string }
		assert.match(topIn.$id, /^backend\.reports\.top_pages\/input\/[0-9a-f]{12}$/)
		assert.match(topOut.$id, /^backend\.reports\.top_pages\/output\/[0-9a-f]{12}$/)
		const pub = entries.find((e) => e.name === 'backend.reports.publish')
		assert.equal(pub?.sideEffect, true)
		const ping = entries.find((e) => e.name === 'backend.reports.ping')
		assert.deepEqual((ping?.inputSchema as { required: unknown }).required, [])
	})

	it('fails on unsupported field types', () => {
		const bad = `pub struct A {\npub:\n\tpayload json.Any\n}\n@[tool]\npub fn f(args A) string { return '' }`
		assert.throws(
			() => toolManifestFor('backend/bad', parseVFile(bad), parseStructs(bad)),
			/unsupported V type/
		)
	})

	it('rejects arrays of structs loudly instead of flattening them', () => {
		// Contract pin for the struct-ref guard in structSchema: an
		// array-typed field must go through the array projection (or fail
		// loudly in fieldSchema) — never resolve as a nested struct `$ref`
		// and flatten to a bare `{ type: 'object' }`.
		// (`/^(\[|…)/` replaced a lint-rejected `/^([]|…)/`; the
		// `/^[A-Za-z_]/` conjunct already excluded `[`-leading types, so the
		// change is lint-level — this pins the behavior it protects.)
		const src = `pub struct Row {\npub:\n\ttitle string\n}\npub struct A {\npub:\n\trows []Row\n}\n@[tool]\npub fn f(args A) string { return '' }`
		assert.throws(
			() => toolManifestFor('backend/m', parseVFile(src), parseStructs(src)),
			/unsupported V type '\[\]Row'/
		)
	})


	describe('schema identity + nullable + arrays', () => {
		it('wire change publishes a different identity; same shape reuses it', () => {
			const a = `pub struct A {\npub:\n\tq string\n}\n@[tool]\npub fn f(args A) string { return '' }`
			const b = `pub struct A {\npub:\n\tq bool\n}\n@[tool]\npub fn f(args A) string { return '' }`
			const idA = (toolManifestFor('backend/m', parseVFile(a), parseStructs(a))[0]?.inputSchema as { $id: string }).$id
			const idA2 = (toolManifestFor('backend/m', parseVFile(a), parseStructs(a))[0]?.inputSchema as { $id: string }).$id
			const idB = (toolManifestFor('backend/m', parseVFile(b), parseStructs(b))[0]?.inputSchema as { $id: string }).$id
			assert.equal(idA, idA2)
			assert.notEqual(idA, idB)
		})

		it('nullable ?string admits omission, explicit null, and string', () => {
			const src = `pub struct A {\npub:\n\tq ?string\n}\n@[tool]\npub fn f(args A) string { return '' }`
			const [entry] = toolManifestFor('backend/m', parseVFile(src), parseStructs(src))
			assert.ok(entry)
			const props = (entry.inputSchema as { properties: Record<string, unknown> }).properties
			assert.deepEqual(props['q'], { type: ['string', 'null'] })
			assert.deepEqual((entry.inputSchema as { required: string[] }).required, [])
		})

		it('nullable nested struct admits null', () => {
			const src = `pub struct Inner {\npub:\n\tt string\n}\npub struct A {\npub:\n\tin ?Inner\n}\n@[tool]\npub fn f(args A) string { return '' }`
			const [entry] = toolManifestFor('backend/m', parseVFile(src), parseStructs(src))
			assert.ok(entry)
			const props = (entry.inputSchema as { properties: Record<string, unknown> }).properties
			const inner = props['in'] as { type: unknown }
			assert.deepEqual(inner.type, ['object', 'null'])
		})

		it('[][]string projects exactly two array layers', () => {
			const src = `pub struct A {\npub:\n\tq string\n}\n@[tool]\npub fn f(args A) [][]string { return [['a']] }`
			const [entry] = toolManifestFor('backend/m', parseVFile(src), parseStructs(src))
			assert.ok(entry)
			assert.deepEqual(entry.outputSchema, {
					type: 'array',
					items: { type: 'array', items: { type: 'string' } },
					$id: (entry.outputSchema as { $id: string }).$id,
			})
		})
	})

	it('emits a versioned canonical manifest body', () => {
		const entries = toolManifestFor('backend/reports', parseVFile(SRC), parseStructs(SRC))
		const body = emitToolManifest(entries)
		assert.deepEqual(JSON.parse(body), { version: 1, tools: entries })
	})
})

	/** Shared fixture for the approval-gate V tests: backend module with one
	 *  read-only + one side-effect tool, dispatcher with the gate armed.
	 *  Each `it` appends its own `fn test_*` fns then runs `v test`. */
	const approvalGatePrelude = () => {
		const fs = require('node:fs') as typeof import('node:fs')
		const os = require('node:os') as typeof import('node:os')
		const path = require('node:path') as typeof import('node:path')
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-tool-approve-'))
		fs.mkdirSync(path.join(dir, 'backend'), { recursive: true })
		fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
		fs.writeFileSync(
			path.join(dir, 'backend', 'reports.v'),
			[
				'module backend',
				'',
				'pub struct PageArgs {',
				'pub:',
				'\tlimit int',
				'\tquery string',
				'}',
				'',
				'pub struct PageRow {',
				'pub:',
				'\ttitle string',
				'}',
				'',
				'pub fn top_pages(args PageArgs) ![]PageRow {',
				'\tif args.limit <= 0 {',
				"\t\treturn error('limit must be positive')",
				'\t}',
				"\treturn [PageRow{ title: args.query + '-1' }]",
				'}',
				'',
				"@[tool('side-effect')]",
				'pub fn publish(args PageArgs) ![]PageRow {',
				'\tif args.limit <= 0 {',
				"\t\treturn error('limit must be positive')",
				'\t}',
				"\treturn [PageRow{ title: 'published-' + args.query }]",
				'}',
				'',
			].join('\n'),
		)
		const repSrc = [
			'module reports',
			'',
			'pub struct PageArgs {',
			'pub:',
			'\tlimit int',
			'\tquery string',
			'}',
			'',
			"@[tool] pub fn top_pages(args PageArgs) !string { return 'x' }",
			"@[tool('side-effect')] pub fn publish(args PageArgs) !string { return 'y' }",
		].join('\n')
		const repFns = parseVFile(repSrc).filter((f) => f.attr === 'tool')
		fs.writeFileSync(
			path.join(dir, 'tools', 'tools.gen.v'),
			emitToolDispatcher([
				{
					mod: 'backend/reports',
					dir: 'backend',
					fns: repFns.map((f) => ({
						fn: f.name,
						argsStruct: f.singleArgsStruct ?? null,
						fallible: f.fallible,
						sideEffect: f.name === 'publish',
					})),
				},
			]),
		)
		return {
			dir,

			args: JSON.stringify(JSON.stringify({ limit: 2, query: 'go' })),
			want: JSON.stringify(JSON.stringify([{ title: 'go-1' }])),
			pubWant: JSON.stringify(JSON.stringify([{ title: 'published-go' }])),
			tests: ['module tools', ''] as string[],
		}
	}

	it('approval gate p1: read-only ignores; missing/unknown op fails closed', function () {
		const gate = approvalGatePrelude()
		gate.tests.push(
			'fn test_read_only_ignores_caller_and_op() {',
			"\tname := 'backend.reports.top_pages'",
			'\tres := swelte_tool_dispatch([name], name, ' + gate.args + ", '', '') or {",
			"\t\tassert false, 'read-only dispatch failed: ' + err.msg()",
			'\t\treturn',
			'\t}',
			'\tassert res == ' + gate.want + ", 'unexpected: ' + res",
			'}',
			'',
			'fn test_side_effect_without_op_fails_closed() {',
			"\tname := 'backend.reports.publish'",
			'\tswelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', '') or {",
			"\t\tassert err.msg().contains('approval required'), 'wrong error: ' + err.msg()",
			'\t\treturn',
			'\t}',
			"\tassert false, 'unapproved side effect ran'",
			'}',
			'',
			'fn test_unknown_op_fails_closed() {',
			"\tname := 'backend.reports.publish'",
			'\tswelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', 'op-nope') or {",
			"\t\tassert err.msg().contains('unknown approval'), 'wrong error: ' + err.msg()",
			'\t\treturn',
			'\t}',
			"\tassert false, 'unknown op ran'",
			'}',
			'',
			'',
		)
		approvalGateRun(gate)
	})
	it('approval gate p2: approved op runs once then replays (lost-ack)', function () {
		const gate = approvalGatePrelude()
		gate.tests.push(
			'fn test_approved_op_runs_once_then_replays() {',
			"\tname := 'backend.reports.publish'",
			"\tswelte_tool_approval_record('ai', name, " + gate.args + ", 'op-1')",
			"\tswelte_tool_approval_decide('op-1', 'approved')",
			'\tres := swelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', 'op-1') or {",
			"\t\tassert false, 'approved dispatch failed: ' + err.msg()",
			'\t\treturn',
			'\t}',
			'\tassert res == ' + gate.pubWant + ", 'unexpected: ' + res",
			'\tres2 := swelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', 'op-1') or {",
			"\t\tassert false, 'replay failed: ' + err.msg()",
			'\t\treturn',
			'\t}',
			'\tassert res2 == ' + gate.pubWant + ", 'replay diverged: ' + res2",
			'}',
			'',
			'',
		)
		approvalGateRun(gate)
	})
	it('approval gate p3: mismatched binding fails closed', function () {
		const gate = approvalGatePrelude()
		gate.tests.push(
			'fn test_mismatched_binding_fails_closed() {',
			"\tname := 'backend.reports.publish'",
			"\tswelte_tool_approval_record('ai', name, " + gate.args + ", 'op-2')",
			"\tswelte_tool_approval_decide('op-2', 'approved')",
			'\tswelte_tool_dispatch([name], name, ' + gate.args + ", 'human', 'op-2') or {",
			"\t\tassert err.msg().contains('mismatch'), 'wrong error: ' + err.msg()",
			'\t\treturn',
			'\t}',
			"\tassert false, 'cross-caller op ran'",
			'\tother := \'{\\"limit\\":3,\\"query\\":\\"go\\"}\'',
			'\tswelte_tool_dispatch([name], name, other, \'ai\', \'op-2\') or {',
			"\t\tassert err.msg().contains('mismatch'), 'wrong error: ' + err.msg()",
			'\t\treturn',
			'\t}',
			"\tassert false, 'cross-args op ran'",
			'}',
			'',
			'',
		)
		approvalGateRun(gate)
	})
	it('approval gate p4: denied/pending/expired never execute; duplicates fold', function () {
		const gate = approvalGatePrelude()
		gate.tests.push(
			'fn test_denied_and_pending_never_execute() {',
			"\tname := 'backend.reports.publish'",
			"\tswelte_tool_approval_record('ai', name, " + gate.args + ", 'op-denied')",
			"\tswelte_tool_approval_decide('op-denied', 'denied')",
			'\tswelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', 'op-denied') or {",
			"\t\tassert err.msg().contains('not granted'), 'wrong error: ' + err.msg()",
			'\t\treturn',
			'\t}',
			"\tassert false, 'denied op ran'",
			"\tswelte_tool_approval_record('ai', name, " + gate.args + ", 'op-pending')",
			'\tswelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', 'op-pending') or {",
			"\t\tassert err.msg().contains('not granted'), 'wrong error: ' + err.msg()",
			'\t\treturn',
			'\t}',
			"\tassert false, 'pending op ran'",
			"\tswelte_tool_approval_record('ai', name, " + gate.args + ", 'op-expired')",
			"\tswelte_tool_approval_decide('op-expired', 'expired')",
			'\tswelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', 'op-expired') or {",
			"\t\tassert err.msg().contains('not granted'), 'wrong error: ' + err.msg()",
			'\t\treturn',
			'\t}',
			"\tassert false, 'expired op ran'",
			'}',
			'',
			'fn test_duplicate_record_and_decide_fold_away() {',
			"\tname := 'backend.reports.publish'",
			"\tswelte_tool_approval_record('ai', name, " + gate.args + ", 'op-dup')",
			"\tswelte_tool_approval_record('human', name, " + gate.args + ", 'op-dup')",
			"\tswelte_tool_approval_decide('op-dup', 'approved')",
			"\tswelte_tool_approval_decide('op-dup', 'denied')",
			'\tres := swelte_tool_dispatch([name], name, ' + gate.args + ", 'ai', 'op-dup') or {",
			"\t\tassert false, 'first-decision dispatch failed: ' + err.msg()",
			'\t\treturn',
			'\t}',
			'\tassert res == ' + gate.pubWant + ", 'unexpected: ' + res",
			'}',
			'',
			'',
		)
		approvalGateRun(gate)
	})
	const approvalGateRun = (gate: { dir: string; tests: string[] }) => {
		const { resolveV, vVersion } = require('@swelte/core/toolchain') as typeof import('@swelte/core/toolchain')
		const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
		const fs = require('node:fs') as typeof import('node:fs')
		const path = require('node:path') as typeof import('node:path')
		const vbin: string = resolveV(import.meta.url)
		if (vVersion(vbin).startsWith('(not found')) {
			console.log('SKIP approval gate test: no V toolchain')
			fs.rmSync(gate.dir, { recursive: true, force: true })
			return
		}
		try {
			fs.writeFileSync(
				path.join(gate.dir, 'tools', 'tools_approval_test.v'),
				[...gate.tests, ''].join('\n'),
			)
			// The approval table uses `__global` (same as the QJS bridge
			// and backend hub): `v test` needs the flag explicitly.
			execFileSync(vbin, ['-enable-globals', 'test', path.join(gate.dir, 'tools')], { stdio: 'pipe' })
		} finally {
			fs.rmSync(gate.dir, { recursive: true, force: true })
		}
	}


describe('C.1 call path: select, dispatch, validate, V result', () => {
	const TWO_TOOL_SRC = `module reports

pub struct PageArgs {
pub:
\tlimit int
\tquery string
}

pub struct PageRow {
pub:
\ttitle string
}

// Top pages by views.
@[tool]
pub fn top_pages(args PageArgs) ![]PageRow {
\tif args.limit <= 0 {
\t\treturn error('limit must be positive')
\t}
\treturn [PageRow{ title: args.query + '-1' }]
}

@[tool]
pub fn ping() string {
\treturn 'ok'
}

// Side-effecting publish (needs backend approval at dispatch).
@[tool('side-effect')]
pub fn publish(args PageArgs) ![]PageRow {
\tif args.limit <= 0 {
\t\treturn error('limit must be positive')
\t}
\treturn [PageRow{ title: 'published-' + args.query }]
}
`
	const manifestOf = () => {
		const fns = parseVFile(TWO_TOOL_SRC).filter((f) => f.attr === 'tool')
		return {
			fns,
			manifest: { version: 1 as const, tools: toolManifestFor('backend/reports', fns, parseStructs(TWO_TOOL_SRC), toolDocComments(TWO_TOOL_SRC)) },
		}
	}

	it('selects a subset; unknown names fail closed', () => {
		const { manifest } = manifestOf()
		const selected = selectTools(manifest, ['backend.reports.top_pages'])
		assert.deepEqual(selected.map((t) => t.name), ['backend.reports.top_pages'])
		assert.throws(() => selectTools(manifest, ['backend.reports.nope']), /unknown tool/)
	})

	it('validates args/results against the projected schema', () => {
		const { manifest } = manifestOf()
		const [top] = selectTools(manifest, ['backend.reports.top_pages'])
		assert.ok(top)
		assert.deepEqual(validateAgainstSchema(top.inputSchema, { limit: 2, query: 'go' }), [])
		assert.ok(validateAgainstSchema(top.inputSchema, { limit: 'x', query: 'go' }).length > 0)
		assert.ok(validateAgainstSchema(top.inputSchema, { limit: 2 }).length > 0)
		assert.ok(validateAgainstSchema(top.inputSchema, { limit: 2, query: 'go', extra: 1 }).length > 0)
		assert.deepEqual(validateAgainstSchema(top.outputSchema, [{ title: 'go-1' }]), [])
		assert.ok(validateAgainstSchema(top.outputSchema, [{ title: 1 }]).length > 0)
		// Fallible V error path surfaces as a transport rejection, not a value.
	})

	it('map values validate against additionalProperties; explicit undefined fails', async () => {
		// map[string]int projects additionalProperties {type:'number'}.
		const mapSchema = {
			type: 'object',
			properties: {},
			required: [],
			additionalProperties: { type: 'number' },
		}
		assert.deepEqual(validateAgainstSchema(mapSchema, { count: 3 }), [])
		assert.ok(validateAgainstSchema(mapSchema, { count: 'many' }).length > 0)
		// Required string set to explicit undefined fails (undefined is not JSON).
		const strSchema = {
			type: 'object',
			properties: { query: { type: 'string' } },
			required: ['query'],
			additionalProperties: false,
		}
		assert.ok(validateAgainstSchema(strSchema, { query: undefined }).length > 0)
		// Same vectors through the generated binding validator: transport
		// must never be called for invalid args.
		const fs = require('node:fs') as typeof import('node:fs')
		const os = require('node:os') as typeof import('node:os')
		const path = require('node:path') as typeof import('node:path')
		const { pathToFileURL } = require('node:url') as typeof import('node:url')
		const calls: unknown[] = []
		const transport = async (name: string, args: unknown) => {
			calls.push([name, args])
			return args
		}
		const entries: ToolManifestEntry[] = [
			{
				name: 'm.counts',
				sideEffect: false,
				description: '',
				inputSchema: mapSchema,
				outputSchema: { type: 'object' },
			},
			{
				name: 'm.query',
				sideEffect: false,
				description: '',
				inputSchema: strSchema,
				outputSchema: { type: 'object' },
			},
		]
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-tool-p2-'))
		try {
			const file = path.join(dir, 'tools.gen.mjs')
			fs.writeFileSync(file, emitToolBindings(entries))
			const bindings = (await import(pathToFileURL(file).href)) as {
				createRunTools: (selected: string[], t: (n: string, a: unknown) => Promise<unknown>) => Record<string, (a: unknown) => Promise<unknown>>
			}
			const run = bindings.createRunTools(['m.counts', 'm.query'], transport)
			await assert.rejects(() => run['m.counts']({ count: 'many' }), /invalid args/)
			await assert.rejects(() => run['m.query']({ query: undefined }), /invalid args/)
			assert.deepEqual(calls, [], 'invalid args must never reach the transport')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

		it('generated run object carries only the selection; unselected has no callable', async () => {
		const { manifest } = manifestOf();
		const selected = selectTools(manifest, ['backend.reports.top_pages']);
		const fs = require('node:fs') as typeof import('node:fs');
		const os = require('node:os') as typeof import('node:os');
		const path = require('node:path') as typeof import('node:path');
		const { pathToFileURL } = require('node:url') as typeof import('node:url');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-tool-bindings-'));
		try {
			const file = path.join(dir, 'tools.gen.mjs');
			fs.writeFileSync(file, emitToolBindings(manifest.tools));
			const bindings = (await import(pathToFileURL(file).href)) as {
			createRunTools: (selected: string[], transport: (n: string, a: unknown) => Promise<unknown>) => Record<string, (args: unknown) => Promise<unknown>>;
			callSelectedTool: (selected: unknown, name: string, args: unknown, transport: (n: string, a: unknown) => Promise<unknown>) => Promise<unknown>;
			};
			const calls: [string, unknown][] = [];
			const transport = async (name: string, args: unknown) => {
			calls.push([name, args]);
			if (name === 'backend.reports.top_pages') {
			const a = args as { limit: number; query: string };
			if (a.limit <= 0) throw new Error('limit must be positive');
			return [{ title: `${a.query}-1` }];
			}
			throw new Error(`unexpected transport call: ${name}`);
			};
			// Run object for a top_pages-only run: top dispatches, ping has no callable.
			const run = bindings.createRunTools(['backend.reports.top_pages'], transport);
			assert.deepEqual(Object.keys(run), ['backend.reports.top_pages']);
			const got = await run['backend.reports.top_pages']({ limit: 2, query: 'go' });
			assert.deepEqual(got, [{ title: 'go-1' }]);
			assert.deepEqual(calls, [['backend.reports.top_pages', { limit: 2, query: 'go' }]]);
			assert.equal((run as Record<string, unknown>)['backend.reports.ping'], undefined);
			assert.equal(calls.length, 1, 'unselected tool must never reach the transport');
			await assert.rejects(
			() => bindings.callSelectedTool(selected, 'backend.reports.ping', {}, transport),
			/not selected for this run/,
			);
			assert.equal(calls.length, 1, 'rejected call must never reach the transport');
			await assert.rejects(
			() => (run['backend.reports.top_pages'] as (a: unknown) => Promise<unknown>)({ limit: 'x', query: 'go' }),
			/invalid args/,
			);
			assert.equal(calls.length, 1, 'invalid args must never reach the transport');
		} finally {
		fs.rmSync(dir, { recursive: true, force: true });
		}
		}),

	it('keeps colliding flattened names independently callable', async () => {
		const names = ['backend.sales_report.list', 'backend.sales.report_list']
		const ping = manifestOf().manifest.tools.find(tool => tool.name.endsWith('.ping'))!
		const source = emitToolBindings(names.map(name => ({ ...ping, name })))
		const bindings = await import('data:text/javascript,' + encodeURIComponent(source))
		const run = bindings.createRunTools(names, async (name: string) => name)
		for (const name of names) assert.equal(await run[name]({}), name)
	})

	it('emitted V dispatcher executes against real V fns (native v test)', function () {
		// End-to-end of the generated call path: manifest -> dispatcher -> V
		// result, independent of the QuickJS agent runtime. Skips when the V
		// toolchain is unavailable (unit coverage above still runs).
		const { resolveV, vVersion } = require('@swelte/core/toolchain') as typeof import('@swelte/core/toolchain')
		const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
		const fs = require('node:fs') as typeof import('node:fs')
		const os = require('node:os') as typeof import('node:os')
		const path = require('node:path') as typeof import('node:path')
		const vbin: string = resolveV(import.meta.url)
		if (vVersion(vbin).startsWith('(not found')) {
			console.log('SKIP native tool dispatch test: no V toolchain')
		return
		}
		const { fns } = manifestOf()
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-tool-c1-'))
		try {
			fs.mkdirSync(path.join(dir, 'backend'), { recursive: true })
			fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
			// Backend module: same shapes as TWO_TOOL_SRC minus the attrs
			// (attrs live in the app file; the dispatcher targets fns).
			fs.writeFileSync(
				path.join(dir, 'backend', 'reports.v'),
				[
					'module backend',
				'',
					'pub struct PageArgs {',
					'pub:',
					'\tlimit int',
					'\tquery string',
				'}',
				'',
					'pub struct PageRow {',
					'pub:',
					'\ttitle string',
					'}',
				'',
					'pub fn top_pages(args PageArgs) ![]PageRow {',
					'\tif args.limit <= 0 {',
					"\t\treturn error('limit must be positive')",
					'\t}',
					"\treturn [PageRow{ title: args.query + '-1' }]",
					'}',
				'',
					'pub fn publish(args PageArgs) ![]PageRow {',
					'\tif args.limit <= 0 {',
					"\t\treturn error('limit must be positive')",
					'\t}',
					"\treturn [PageRow{ title: 'published-' + args.query }]",
					'}',
					'',
					'pub fn ping() string {',
					"\treturn 'ok'",
					'}',
					'',
				].join('\n'),
			)
			fs.writeFileSync(
				path.join(dir, 'tools', 'tools.gen.v'),
					emitToolDispatcher([
						{
							mod: 'backend/reports',
							dir: 'backend',
							fns: fns.map((f) => ({
							fn: f.name,
							argsStruct: f.singleArgsStruct ?? null,
							fallible: f.fallible,
							sideEffect: f.name === 'publish',
						})),
						},
					]),
			)
				const vArgs = JSON.stringify(JSON.stringify({ limit: 2, query: 'go' }));
				const vWant = JSON.stringify(JSON.stringify([{ title: 'go-1' }]));
				const vBad = JSON.stringify(JSON.stringify({ limit: 0, query: 'go' }));
				fs.writeFileSync(
				path.join(dir, 'tools', 'tools_test.v'),
				[
				'module tools',
				'',
					`fn test_zero_args_require_empty_object() {
	name := 'backend.reports.ping'
	assert swelte_tool_dispatch([name], name, ' {  } ', '', '')! == '"ok"'
	for invalid in ['{}{}', '{"x":1}', '[]', '', '{'] {
		swelte_tool_dispatch([name], name, invalid, '', '') or { continue }
		assert false, 'accepted invalid payload: ' + invalid
	}
}`,
					'fn test_dispatch_selected_tool_returns_v_result() {',
					'\tallowed := [\'backend.reports.top_pages\']',
					'\tres := swelte_tool_dispatch(allowed, \'backend.reports.top_pages\', ' + vArgs + ', \'\', \'\') or {',
					'\t\tassert false, \'dispatch failed: \' + err.msg()',
					'\t\treturn',
					'\t}',
					'\tassert res == ' + vWant + ', \'unexpected result: \' + res',
					'}',
					'',
					'fn test_dispatch_unselected_tool_is_unavailable() {',
					'\tswelte_tool_dispatch([\'\'], \'backend.reports.unlisted\', \'{}\', \'\', \'\') or {',
					'\t\tassert err.msg().contains(\'tool not selected\'), \'wrong error: \' + err.msg()',
					'\t\treturn',
					'\t}',
					'\tassert false, \'unlisted tool should fail\'',
					'}',
					'',
					'fn test_dispatch_compiled_but_unselected_tool_never_runs() {',
					'\t// top_pages with limit 0 would fail inside the V fn (\'limit must be',
					'\t// positive\'); the selection error must win, proving non-execution.',
				'\tbad_args := ' + vBad,
					'\tswelte_tool_dispatch([\'backend.reports.ping\'], \'backend.reports.top_pages\', bad_args, \'\', \'\') or {',
					'\t\tassert err.msg().contains(\'tool not selected\'), \'wrong error (V fn ran?): \' + err.msg()',
					'\t\treturn',
					'\t}',
					'\tassert false, \'unselected compiled tool should fail\'',
					'}',
					'',
				'',
				].join('\n'),
				)
			// Side-effect fn present (gate armed → `__global` approval table):
			// `v test` needs the flag explicitly (same as the QJS bridge).
			execFileSync(vbin, ['-enable-globals', 'test', path.join(dir, 'tools')], { stdio: 'pipe' })
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
	it('sibling backend modules coexist: per-dir imports, qualified calls, shared fn names', function () {
		const { resolveV, vVersion } = require('@swelte/core/toolchain') as typeof import('@swelte/core/toolchain')
		const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
		const fs = require('node:fs') as typeof import('node:fs')
		const os = require('node:os') as typeof import('node:os')
		const path = require('node:path') as typeof import('node:path')
		const vbin: string = resolveV(import.meta.url)
		if (vVersion(vbin).startsWith('(not found')) {
			console.log('SKIP multi-module tool dispatch test: no V toolchain')
			return
		}
		// Two backend dirs declaring the same fn name `list`: the dispatcher
		// must import each dir and qualify each call (no duplicate V symbols,
		// no cross-wired dispatch). Compiled in file mode (`v -o probe_main.v`)
		// like the production harness; `v test <dir>` does not resolve nested
		// sibling imports.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-tool-multi-'))
		try {
			for (const d of ['backend/reports', 'backend/billing/reports', 'tools']) fs.mkdirSync(path.join(dir, d), { recursive: true })
			fs.writeFileSync(
			path.join(dir, 'backend', 'reports', 'top.v'),
			['module reports', '', 'pub struct ListArgs {', 'pub:', '\tlimit int', '}', '', 'pub fn list(args ListArgs) string {', '\treturn \'reports:\' + args.limit.str()', '}', ''].join('\n'),
			)
			fs.writeFileSync(
			path.join(dir, 'backend', 'billing', 'reports', 'charges.v'),
			['module reports', '', 'pub struct ListArgs {', 'pub:', '\tcurrency string', '}', '', 'pub fn list(args ListArgs) string {', '\treturn \'billing:\' + args.currency', '}', ''].join('\n'),
			)
			const repSrc = ['module reports', '', 'pub struct ListArgs {', 'pub:', '\tlimit int', '}', '', '@[tool]', 'pub fn list(args ListArgs) string {', '\treturn \'x\'', '}'].join('\n')
			const bilSrc = ['module reports', '', 'pub struct ListArgs {', 'pub:', '\tcurrency string', '}', '', '@[tool]', 'pub fn list(args ListArgs) string {', '\treturn \'x\'', '}'].join('\n')
			const repFns = parseVFile(repSrc).filter((f) => f.attr === 'tool')
			const bilFns = parseVFile(bilSrc).filter((f) => f.attr === 'tool')
			const targets = [
			{ mod: 'backend/reports', dir: 'backend/reports', fns: repFns.map((f) => ({ fn: f.name, argsStruct: f.singleArgsStruct ?? null, fallible: f.fallible })) },
			{ mod: 'backend/billing/reports', dir: 'backend/billing/reports', fns: bilFns.map((f) => ({ fn: f.name, argsStruct: f.singleArgsStruct ?? null, fallible: f.fallible })) },
			]
			const js = emitToolDispatcher([...targets, { mod: 'backend/reports/extra', dir: 'backend/reports', fns: [] }])
			assert.equal(js.split('import backend.reports as ').length - 1, 1)
			assert.ok(js.includes("import backend.reports"), 'dispatcher must import the reports dir')
			assert.ok(js.includes("import backend.billing"), 'dispatcher must import the billing dir')
			assert.ok(js.includes('toolmod_0.list(args)'), 'reports call must be qualified')
			assert.ok(js.includes('toolmod_1.list(args)'), 'billing call must be qualified')
			fs.writeFileSync(path.join(dir, 'tools', 'tools.gen.v'), js)
			const bindings = emitToolBindings(toolManifestFor('x', [], []))
			assert.ok(!bindings.includes('export async function list('), 'no bare list export (would collide)')
			// Two same-named tools produce distinct JS exports.
			const both = emitToolBindings([
			...toolManifestFor('backend/reports', repFns, parseStructs(repSrc)),
			...toolManifestFor('backend/billing/reports', bilFns, parseStructs(bilSrc)),
			])
			assert.ok(both.includes('backend.reports.list'), 'reports list export present')
			assert.ok(both.includes('backend.billing.reports.list'), 'billing list export present')
			// Native execution in file mode (production-equivalent resolution).
			fs.writeFileSync(
			path.join(dir, 'probe_main.v'),
			[
			'module main',
			'',
			'import tools',
			'',
			'fn main() {',
			'\ta := tools.swelte_tool_dispatch([\'backend.reports.list\'], \'backend.reports.list\', \'{\\"limit\\":3}\', \'\', \'\') or { panic(err) }',
			'\tassert a == \'\\"reports:3\\"\', \'reports wrong: \' + a',
			'\tb := tools.swelte_tool_dispatch([\'backend.billing.reports.list\'], \'backend.billing.reports.list\', \'{\\"currency\\":\\"EUR\\"}\', \'\', \'\') or { panic(err) }',
			'\tassert b == \'\\"billing:EUR\\"\', \'billing wrong: \' + b',
			'\ttools.swelte_tool_dispatch([\'backend.reports.list\'], \'backend.billing.reports.list\', \'{}\', \'\', \'\') or {',
			'\t\tassert err.msg().contains(\'tool not selected\'), \'sibling ran?: \' + err.msg()',
			'\t\tprintln(\'sibling-rejected-ok\')',
			'\t\treturn',
			'\t}',
			'\teprintln(\'ERROR: unselected sibling ran\')',
			'}',
			''].join('\n'),
			)
			const bin = path.join(dir, 'probe')
			execFileSync(vbin, ['-o', bin, 'probe_main.v'], { cwd: dir, stdio: 'pipe' })
			const out = execFileSync(bin, { encoding: 'utf8' })
			assert.ok(out.includes('sibling-rejected-ok'), 'unselected sibling must be rejected, got: ' + out)
		} finally {
		fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	describe('§2 explicit plugin registration (provider-only vs tool-using)', () => {
		const mkApp = (withTools: boolean) => {
			const fs = require('node:fs') as typeof import('node:fs')
			const os = require('node:os') as typeof import('node:os')
			const path = require('node:path') as typeof import('node:path')
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-ai-plugin-'))
			fs.mkdirSync(path.join(root, 'src', 'routes', 'api'), { recursive: true })
			fs.mkdirSync(path.join(root, 'src', 'lib', 'backend'), { recursive: true })
			fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","type":"module"}')
			fs.writeFileSync(path.join(root, 'svelte.config.js'), 'export default {}')
			// Local install probe: a real `@swelte/ai` dependency (package.json
			// only, no `./swelte/build` export) must stay inert without the plugin.
			const depDir = path.join(root, 'node_modules', '@swelte', 'ai')
			fs.mkdirSync(depDir, { recursive: true })
			fs.writeFileSync(
				path.join(depDir, 'package.json'),
				JSON.stringify({ name: '@swelte/ai', version: '0.0.0-test', exports: { '.': './index.js', './tools': './tools.js' } }),
			)
			fs.writeFileSync(path.join(root, 'src', 'app.v'), 'module app\n')
			fs.writeFileSync(
				path.join(root, 'src', 'routes', 'api', 'ping.v'),
				'module api_ping\n@[get]\npub fn ping() string {\n\treturn "pong"\n}\n',
			)
			if (withTools) {
				fs.writeFileSync(
					path.join(root, 'src', 'lib', 'backend', 'jobs.v'),
					'module backend\npub struct JobArgs {\npub:\n\tlimit int\n}\n@[tool]\npub fn run(args JobArgs) string {\n\treturn \'n=\' + args.limit.str()\n}\n',
				)
			}
			return root
		}
		const generateWith = async (root: string, plugins: import('@swelte/core/vite').SweltePlugin[]) => {
			const { swelte } = await import('@swelte/core/vite')
			const plug = swelte({ plugins }) as unknown as {
				configResolved?: (c: { root: string }) => void
				buildStart?: () => Promise<void>
			}
			plug.configResolved?.({ root })
			await plug.buildStart?.()
		}
		it('provider-only app (no plugin) emits no tools module', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const root = mkApp(false)
			try {
				await generateWith(root, [])
				assert.equal(fs.existsSync(path.join(root, '.swelte', 'tools')), false)
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
		it('installed @swelte/ai without registration stays inert (no throw, no tools)', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const root = mkApp(true)
			try {
				// Tool declarations present but the plugin not registered:
				// core must ignore the attr (not emit, not throw) — mirrors a
				// provider-only install where `@swelte/ai` ships no `./swelte/build`.
				await generateWith(root, [])
				assert.equal(fs.existsSync(path.join(root, '.swelte', 'tools')), false)
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
		it('tool-using app (plugin) emits bindings and a callable native tool', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const os = require('node:os') as typeof import('node:os')
			const path = require('node:path') as typeof import('node:path')
			const { pathToFileURL } = require('node:url') as typeof import('node:url')
			const { createToolsPlugin } = await import('../src/lib/tools.js')
			const root = mkApp(true)
			try {
				await generateWith(root, [createToolsPlugin()])
				const manifest = JSON.parse(
					fs.readFileSync(path.join(root, '.swelte', 'tools', 'tool_manifest.json'), 'utf8'),
				) as { tools: { name: string }[] }
				assert.deepEqual(
					manifest.tools.map((t) => t.name),
					['backend.jobs.run'],
				)
				const bindings = await import(
					pathToFileURL(path.join(root, '.swelte', 'tools', 'tools.gen.mjs')).href
				)
				const run = bindings.createRunTools(['backend.jobs.run'], async (name: string, args: unknown) => `${name}:${JSON.stringify(args)}`)
				assert.equal(await run['backend.jobs.run']({ limit: 2 }), 'backend.jobs.run:{"limit":2}')
				assert.equal(run['backend.jobs.nope'], undefined)
				// The V dispatcher is the native half of the same tool: it must
					// import the declaring dir and expose the manifest name behind the
				// per-run allowlist (unit-level; real V execution covered above).
				const dispatcher = fs.readFileSync(path.join(root, '.swelte', 'tools', 'tools.gen.v'), 'utf8')
				assert.ok(dispatcher.includes('import backend as toolmod_'), 'dispatcher must import the backend dir')
				assert.ok(dispatcher.includes("'backend.jobs.run'"), 'dispatcher must cover the manifest tool')
				assert.ok(dispatcher.includes('tool not selected'), 'dispatcher must enforce the run allowlist')
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
		it('removing the plugin prunes the module in the same output dir', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const { createToolsPlugin } = await import('../src/lib/tools.js')
			const root = mkApp(true)
			try {
				await generateWith(root, [createToolsPlugin()])
				assert.equal(fs.existsSync(path.join(root, '.swelte', 'tools', 'tool_manifest.json')), true)
				await generateWith(root, [])
				assert.equal(fs.existsSync(path.join(root, '.swelte', 'tools')), false)
			} finally {
				fs.rmSync(root, { recursive: true, force: true })
			}
		})

	describe('agent plugin: shared qjs staging + bridge + one archive', () => {
		it('agent bridge evaluates real JS through the shared module (native v test)', function () {
			// Full PTC eval path in V: staged `module qjs` + emitted agent
			// bridge + the real shared archive. Proves the bridge contract
			// (`agent_run_eval`) against the actual QuickJS engine — pure
			// eval, stub-rejected binding (host dispatcher not yet wired),
			// timeout, and result-cap budgets. Skips without a V toolchain
			// or C compiler (unit coverage above still runs).
			const { resolveV, vVersion } = require('@swelte/core/toolchain') as typeof import('@swelte/core/toolchain')
			const { whichCC } = require('@swelte/qjs') as typeof import('@swelte/qjs')
			const { toolchainEnv } = require('@swelte/core/toolchain') as typeof import('@swelte/core/toolchain')
			const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
			const fs = require('node:fs') as typeof import('node:fs')
			const os = require('node:os') as typeof import('node:os')
			const path = require('node:path') as typeof import('node:path')
			const vbin: string = resolveV(import.meta.url)
			if (vVersion(vbin).startsWith('(not found')) {
				console.log('SKIP agent bridge eval test: no V toolchain')
				return
			}
			if (!whichCC()) {
				console.log('SKIP agent bridge eval test: no C compiler (archive build needs gcc/clang)')
				return
			}
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-agent-c1-'))
			try {
				// Stage the shared module + emit the bridge exactly as the
				// plugin generate() does, then compile a probe against them
				// with the real archive (mtime-guarded — reuses the SSR
				// archive when present, proving link-once).
				const { agentQjsModuleDir, agentBridgeSrc } = require('../src/lib/build.js') as typeof import('../src/lib/build.js')
				const qjsSrc = agentQjsModuleDir() as string
				const qjsDst = path.join(dir, 'qjs')
				fs.mkdirSync(qjsDst, { recursive: true })
				for (const f of fs.readdirSync(qjsSrc)) {
					if (f.endsWith('.v')) fs.copyFileSync(path.join(qjsSrc, f), path.join(qjsDst, f))
				}
				const agentDst = path.join(dir, 'agent')
				fs.mkdirSync(agentDst, { recursive: true })
				// Build (or reuse) the shared archive in the probe dir.
				const { buildQjsLib } = require('@swelte/qjs') as typeof import('@swelte/qjs')
				const built = buildQjsLib({ root: dir, outDir: '.' }) as { lib: string; cDir: string }
				fs.writeFileSync(path.join(agentDst, 'agent_bridge.v'), agentBridgeSrc(built.lib, built.cDir, 1000, 16))
				fs.writeFileSync(
					path.join(dir, 'probe_main.v'),
					[
						'module main',
						'',
						'import agent',
						'',
						'fn main() {',
						'\t// Pure eval: no bindings, real QuickJS result.',
						'\tres, ok, reason := agent.agent_run_eval(\'return 1 + 2\', \'[]\', 1000, 16, 10, 65536)',
						'\tassert ok, \'pure eval failed: \' + reason',
						'\tassert res == \'3\', \'unexpected result: \' + res',
						'\tprintln(\'agent-pure-ok\')',
						'\t// Top-level await works (async program wrap).',
						'\tres2, ok2, reason2 := agent.agent_run_eval(\'return await Promise.resolve(41 + 1)\', \'[]\', 1000, 16, 10, 65536)',
						'\tassert ok2, \'await eval failed: \' + reason2',
						'\tassert res2 == \'42\', \'unexpected await result: \' + res2',
						'\tprintln(\'agent-await-ok\')',
						'\t// Declared binding without a wired host dispatcher rejects',
						'\t// actionably (stub names the binding + resolved args) —',
						'\t// the native side effect never runs.',
						'\t_, ok3, reason3 := agent.agent_run_eval(\'return top_commands({"limit": 2})\', \'[{"name": "top_commands"}]\', 1000, 16, 10, 65536)',
						'\tassert !ok3, \'stub binding should reject\'',
						'\tprintln(\'agent-stub-rejects-ok: \' + reason3)',
						'\t// Timeout budget fails closed.',
						'\t_, ok4, reason4 := agent.agent_run_eval(\'while(true){}\', \'[]\', 50, 16, 10, 65536)',
						'\tassert !ok4, \'spin should time out\'',
						'\tassert reason4 == \'timeout\', \'wrong reason: \' + reason4',
						'\tprintln(\'agent-timeout-ok\')',
						'\t// Result cap rejects, never truncates.',
						'\t_, ok5, reason5 := agent.agent_run_eval("return \'x\'.repeat(1000)", \'[]\', 1000, 16, 10, 100)',
						'\tassert !ok5, \'oversize result should reject\'',
						'\tassert reason5 == \'budget-exhausted\', \'wrong reason: \' + reason5',
						'\tprintln(\'agent-result-cap-ok\')',
						'}',
						'',
					].join('\n'),
				)
				const bin = path.join(dir, 'probe')
				// Conda-free env: conda's ld shadows the system linker and
				// breaks the C link (same rule as the ssr-qjs qjs-link test).
				const ccEnv = toolchainEnv()
				execFileSync(vbin, ['-o', bin, '-enable-globals', '-cc', 'gcc', 'probe_main.v'], {
					cwd: dir,
					stdio: 'pipe',
					env: ccEnv,
				})
				const out = execFileSync(bin, { encoding: 'utf8' }) as string
				for (const line of [
					'agent-pure-ok',
					'agent-await-ok',
					'agent-stub-rejects-ok',
					'agent-timeout-ok',
					'agent-result-cap-ok',
				]) {
					assert.ok(out.includes(line), `missing ${line}, got: ` + out)
				}
			} finally {
				fs.rmSync(dir, { recursive: true, force: true })
			}
		})
		it('agentQjsModuleDir resolves to the same bytes the SSR adapter stages', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const { agentQjsModuleDir } = await import('../src/lib/build.js')
			const dir = agentQjsModuleDir()
			assert.ok(fs.existsSync(path.join(dir, 'qjs.v')), `qjs.v missing in ${dir}`)
			assert.ok(fs.existsSync(path.join(dir, 'agent.v')), `agent.v missing in ${dir}`)
			assert.ok(
				fs.existsSync(path.join(dir, 'c', 'swelte_qjs.c')),
				`render glue missing in ${dir}/c`
			)
			assert.ok(
				fs.existsSync(path.join(dir, 'c', 'swelte_agent.c')),
				`agent glue missing in ${dir}/c`
			)
			// Same package both consumers resolve: one engine, staged once
			// no matter how many bridges import it.
			const { qjsCDir } = await import('@swelte/qjs')
			const qjsUrl = import.meta.resolve('@swelte/qjs')
			assert.equal(fs.realpathSync(dir), fs.realpathSync(path.join(qjsCDir(qjsUrl), '..')))
		})
		it('agent bridge source carries the shared-link contract', async () => {
			const { agentBridgeSrc } = await import('../src/lib/build.js')
			const src = agentBridgeSrc('/abs/libqjs.a', '/abs/c', 1000, 16)
			assert.ok(src.includes('module agent'), 'bridge is module agent')
			assert.ok(src.includes('import qjs'), 'bridge imports the shared module')
			assert.ok(src.includes('__global'), 'bridge opts into needsQjsLink')
			assert.ok(src.includes('/abs/libqjs.a@START_LIBS'), 'bridge links the shared archive')
			assert.ok(src.includes('#include "swelte_agent.h"'), 'bridge includes the agent glue')
			assert.ok(src.includes('agent_run_eval'), 'bridge exposes the eval entry')
			assert.ok(src.includes('return 1000'), 'bridge bakes the timeout budget')
			// Agent budgets never leak into the named-call dispatcher: the
			// dispatcher module stays QJS-free (no include, no flag).
			assert.ok(!src.includes('swelte_tool_dispatch'), 'bridge never touches named dispatch')
		})
		it('agent plugin stages qjs/ + emits the bridge; removal prunes both', async () => {
			const fs = require('node:fs') as typeof import('node:fs')
			const path = require('node:path') as typeof import('node:path')
			const { createAgentPlugin } = await import('../src/lib/tools.js')
			const root = mkApp(false)
			// The agent plugin resolves the app root from cwd (same
			// assumption as real `vite build`): chdir into the scratch app
			// for generate, restore after.
			const prevCwd = process.cwd()
			// Resolve the workspace qjs package relative to THIS test file
			// (dist-test/tests → engine/qjs), independent of the
			// process cwd (npm runs per-workspace, not per-repo).
			const { fileURLToPath: f2p } = require('node:url') as typeof import('node:url')
			// dist-test/tests → engine/ai → engine → qjs (three levels).
			const workspaceQjs = path.join(path.dirname(f2p(import.meta.url)), '..', '..', '..', 'qjs')
			try {
				process.chdir(root)
				// Real PTC apps install @swelte/qjs (hard dep: archive
				// builder + shared sources). Mirror that with a workspace
				// symlink so the child import resolves.
				const qjsLink = path.join(root, 'node_modules', '@swelte', 'qjs')
				fs.mkdirSync(path.dirname(qjsLink), { recursive: true })
				try {
					fs.symlinkSync(workspaceQjs, qjsLink, 'dir')
				} catch {
					/* already linked */
				}
				// The plugin resolves @swelte/qjs directly (no network).
				await generateWith(root, [createAgentPlugin()])
				const bridge = path.join(root, '.swelte', 'agent', 'agent_bridge.v')
				assert.ok(fs.existsSync(bridge), 'agent bridge emitted')
				const src = fs.readFileSync(bridge, 'utf8')
				assert.ok(src.includes('module agent'), 'emitted bridge is module agent')
				assert.ok(src.includes('__global'), 'emitted bridge opts into the QJS link')
				assert.ok(
					fs.existsSync(path.join(root, '.swelte', 'qjs', 'qjs.v')),
					'shared qjs module staged'
				)
				assert.ok(
					fs.existsSync(path.join(root, '.swelte', 'qjs', 'agent.v')),
					'agent V half staged'
				)
				// The staged module is byte-identical to the resolved source
				// (no drift between the two consumers is possible).
				const { agentQjsModuleDir } = await import('../src/lib/build.js')
				for (const f of ['qjs.v', 'agent.v']) {
					assert.equal(
						fs.readFileSync(path.join(root, '.swelte', 'qjs', f), 'utf8'),
						fs.readFileSync(path.join(agentQjsModuleDir(), f), 'utf8'),
						`staged ${f} matches the shared source`
					)
				}
				// Removal prunes the bridge + the staged sources. The prebuilt
				// archive stays (mtime-guarded build artifact, inert without
				// a bridge — same rule as the SSR adapter's qjs/ dir).
				await generateWith(root, [])
				assert.equal(fs.existsSync(path.join(root, '.swelte', 'agent')), false)
				assert.equal(fs.existsSync(path.join(root, '.swelte', 'qjs', 'qjs.v')), false)
				assert.equal(fs.existsSync(path.join(root, '.swelte', 'qjs', 'agent.v')), false)
			} finally {
				process.chdir(prevCwd)
				fs.rmSync(root, { recursive: true, force: true })
			}
		})
		it('without @swelte/qjs installed the archive step fails actionably', async () => {
			// The child node process resolves @swelte/qjs from the
			// app root (cwd): point it at an empty dir so resolution fails
			// and assert the error names the install (not a linker crash).
			const fs = require('node:fs') as typeof import('node:fs')
			const os = require('node:os') as typeof import('node:os')
			const path = require('node:path') as typeof import('node:path')
			const { createAgentPlugin } = await import('../src/lib/tools.js')
			const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-agent-noqjs-'))
			try {
				const plugin = createAgentPlugin()
				assert.throws(
					() =>
						plugin.generate!({
							dirs: { routesDir: '', libDir: '', outDir: empty },
							declarations: [],
							config: undefined,
						}),
					/@swelte\/qjs/
				)
			} finally {
				fs.rmSync(empty, { recursive: true, force: true })
			}
		})
	})
	})
})
