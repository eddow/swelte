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
							fns: fns.map((f) => ({ fn: f.name, argsStruct: f.singleArgsStruct ?? null, fallible: f.fallible })),
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
	assert swelte_tool_dispatch([name], name, ' {  } ')! == '"ok"'
	for invalid in ['{}{}', '{"x":1}', '[]', '', '{'] {
		swelte_tool_dispatch([name], name, invalid) or { continue }
		assert false, 'accepted invalid payload: ' + invalid
	}
}`,
					'fn test_dispatch_selected_tool_returns_v_result() {',
					'\tallowed := [\'backend.reports.top_pages\']',
					'\tres := swelte_tool_dispatch(allowed, \'backend.reports.top_pages\', ' + vArgs + ') or {',
					'\t\tassert false, \'dispatch failed: \' + err.msg()',
					'\t\treturn',
					'\t}',
					'\tassert res == ' + vWant + ', \'unexpected result: \' + res',
					'}',
					'',
					'fn test_dispatch_unselected_tool_is_unavailable() {',
					'\tswelte_tool_dispatch([\'\'], \'backend.reports.unlisted\', \'{}\') or {',
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
					'\tswelte_tool_dispatch([\'backend.reports.ping\'], \'backend.reports.top_pages\', bad_args) or {',
					'\t\tassert err.msg().contains(\'tool not selected\'), \'wrong error (V fn ran?): \' + err.msg()',
					'\t\treturn',
					'\t}',
					'\tassert false, \'unselected compiled tool should fail\'',
					'}',
					'',
				'',
				].join('\n'),
				)
			execFileSync(vbin, ['test', path.join(dir, 'tools')], { stdio: 'pipe' })
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
			'\ta := tools.swelte_tool_dispatch([\'backend.reports.list\'], \'backend.reports.list\', \'{\\"limit\\":3}\') or { panic(err) }',
			'\tassert a == \'\\"reports:3\\"\', \'reports wrong: \' + a',
			'\tb := tools.swelte_tool_dispatch([\'backend.billing.reports.list\'], \'backend.billing.reports.list\', \'{\\"currency\\":\\"EUR\\"}\') or { panic(err) }',
			'\tassert b == \'\\"billing:EUR\\"\', \'billing wrong: \' + b',
			'\ttools.swelte_tool_dispatch([\'backend.reports.list\'], \'backend.billing.reports.list\', \'{}\') or {',
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
})
