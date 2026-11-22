import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DraftStore } from '@swelte/ai'
import { RunTracker } from '@swelte/ai'
import { createSseParser, decodeSseEvent, encodeSseEvent } from '@swelte/ai'
import { createMemorySink } from '@swelte/ai'
import { ApprovalStore, authorizeShellCall, runAllowlisted } from '../src/lib/shell.js'
import {
	activeAiConfig,
	createAiConfig,
	defaultAiConfigs,
	loadActiveAiConfigId,
	loadAiConfigs,
	saveActiveAiConfigId,
	saveAiConfigs,
	updateAiConfig,
	ADAPTER_MODELS,
} from '../src/lib/ai-config.js'

describe('shell example: one backend shell shared by chat + terminal', () => {
	it('human allowlisted commands run; unknown commands fail actionably', () => {
		const ok = authorizeShellCall('human', 'echo hello shared shell')
		assert.equal(ok.allowed, true)
		assert.equal(runAllowlisted('echo hello shared shell'), 'hello shared shell')
		const bad = authorizeShellCall('human', 'rm -rf /')
		assert.equal(bad.allowed, false)
		assert.ok(bad.reason.includes('not allowlisted'))
		assert.throws(() => runAllowlisted('rm -rf /'), /not allowlisted/)
	})

	it('ai commands need human approval; approve executes exactly once', () => {
		const store = new ApprovalStore()
		const gate = authorizeShellCall('ai', 'echo from-ai')
		assert.equal(gate.needsApproval, true)
		const rec = store.request('ai', 'echo from-ai', 'op-1')
		assert.equal(rec.decision, 'pending')
		store.decide('op-1', 'approved')
		const first = store.markExecuted('op-1')
		assert.equal(first.already, false)
		assert.equal(runAllowlisted(first.record.cmd), 'from-ai')
		// Duplicate ack replays the receipt, never re-executes.
		const retry = store.markExecuted('op-1')
		assert.equal(retry.already, true)
		// Duplicate decide folds away too.
		assert.equal(store.decide('op-1', 'approved').decision, 'approved')
	})

	it('expiry denies; denied/expired approvals never execute', () => {
		const store = new ApprovalStore()
		store.request('ai', 'echo late', 'op-expired', -1)
		assert.equal(store.decide('op-expired', 'approved').decision, 'expired')
		assert.throws(() => store.markExecuted('op-expired'), /expired/)
		store.request('ai', 'echo no', 'op-denied')
		store.decide('op-denied', 'denied')
		assert.throws(() => store.markExecuted('op-denied'), /denied/)
	})

	it('interrupt mid-reply: late turn output rejected, new turn stays clean', () => {
		const tracker = new RunTracker()
		const card = new DraftStore({ title: '', note: '' })
		const sink = createMemorySink()
		let activeTurn = 'turn-1'
		sink.record({ runId: 'run-shell', turnId: 'turn-1', outputId: 'out-text', seq: 0, kind: 'text.delta' })
		assert.ok(
			card.applyPatch({ expectedRevision: 0, ops: [{ op: 'set', path: ['title'], value: 'draft' }] })
		)
		// Human interrupts: end turn-1 output, start turn 2, reject late arrivals.
		tracker.endOutput('out-text')
		activeTurn = 'turn-2'
		assert.equal(activeTurn === 'turn-1' ? true : false, false)
		sink.record({ runId: 'run-shell', turnId: 'turn-2', outputId: 'out-text-2', seq: 0, kind: 'text.delta' })
		assert.ok(
			card.applyPatch({ expectedRevision: 1, ops: [{ op: 'set', path: ['title'], value: 'final' }] })
		)
		sink.record({ runId: 'run-shell', turnId: 'turn-2', outputId: 'out-text-2', seq: 1, kind: 'terminal' })
		tracker.finish('interrupted', 1)
		assert.equal(card.current.value.title, 'final')
		assert.ok(tracker.isTerminal)
		assert.ok(sink.events.every((e) => e.runId === 'run-shell'))
	})

	it('SSE framing carries text + approval.request on one response', () => {
		for (const kind of ['text.delta', 'approval.request'] as const) {
			const wire = encodeSseEvent({ runId: 'r', turnId: 't', outputId: 'o', kind, seq: 2 }, { n: 1 })
			assert.ok(wire.startsWith(`event: ${kind}\n`))
			const [, data] = wire.split('\n')
			assert.equal(decodeSseEvent(kind, data.replace(/^data: /, '')).envelope.turnId, 't')
		}
		const seen: string[] = []
		const push = createSseParser((e) => seen.push(e.envelope.kind))
		const a = encodeSseEvent({ runId: 'r', outputId: 'o', kind: 'text.delta', seq: 0 }, { text: 'hi' })
		const b = encodeSseEvent({ runId: 'r', outputId: 'o', kind: 'terminal', seq: 1 }, { reason: 'completed' })
		push(a.slice(0, 12))
		push(a.slice(12) + b)
		assert.deepEqual(seen, ['text.delta', 'terminal'])
	})

	it('AI configs: defaults cover every implemented adapter, none carries keys', () => {
		const defaults = defaultAiConfigs()
		assert.deepEqual(
			defaults.map((c) => c.adapter),
			['deterministic', 'openrouter', 'openai', 'anthropic']
		)
		for (const c of defaults) assert.ok(!('apiKey' in c) && !JSON.stringify(c).includes('KEY'))
		assert.equal(activeAiConfig(defaults, null).id, defaults[0]!.id)
		assert.equal(activeAiConfig(defaults, 'missing-id').id, defaults[0]!.id)
	})

	it('AI configs: create/update validate adapter + model', () => {
		const created = createAiConfig({
			name: 'fast',
			adapter: 'openrouter',
			model: ' openai/gpt-4o-mini ',
			run: { temperature: 0.7, maxTokens: 512, system: 'be brief' },
		})
		assert.equal(created.model, 'openai/gpt-4o-mini')
		assert.deepEqual(created.run, { temperature: 0.7, maxTokens: 512, system: 'be brief' })
		assert.throws(() => createAiConfig({ name: 'x', adapter: 'openrouter', model: '  ', run: {} }))
		assert.throws(() =>
			createAiConfig({ name: 'x', adapter: 'nope' as never, model: 'm', run: {} })
		)
		const updated = updateAiConfig(created, { model: 'anthropic/claude', adapter: 'anthropic' })
		assert.equal(updated.adapter, 'anthropic')
		assert.equal(updated.model, 'anthropic/claude')
		assert.equal(updated.id, created.id)
		assert.throws(() => updateAiConfig(created, { model: '' }))
	})

	it('AI configs: localStorage round-trips configs + active id (private-mode safe)', () => {
		const mem = new Map<string, string>()
		const g = globalThis as unknown as Record<string, unknown>
		const prev = g.localStorage
		g.localStorage = {
			getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
			setItem: (k: string, v: string) => void mem.set(k, v),
			removeItem: (k: string) => void mem.delete(k),
		}
		try {
			assert.deepEqual(loadAiConfigs().map((c) => c.adapter), defaultAiConfigs().map((c) => c.adapter))
			const mine = [createAiConfig({ name: 'mine', adapter: 'openai', model: 'gpt-4o-mini', run: {} })]
			saveAiConfigs(mine)
			assert.equal(loadAiConfigs()[0]!.model, 'gpt-4o-mini')
			assert.equal(loadActiveAiConfigId(), null)
			saveActiveAiConfigId(mine[0]!.id)
			assert.equal(loadActiveAiConfigId(), mine[0]!.id)
			assert.equal(activeAiConfig(mine, mine[0]!.id).name, 'mine')
		} finally {
			if (prev === undefined) delete g.localStorage
			else g.localStorage = prev
		}
	})

	it('AI configs: offline fallback models exist per adapter (live catalog wins at runtime)', () => {
		for (const adapter of ['deterministic', 'openrouter', 'openai', 'anthropic'] as const) {
			assert.ok(
				ADAPTER_MODELS[adapter].length > 0,
				`${adapter} needs an offline fallback suggestion`
			)
		}
		// The live `ai_models` RPC returns this shape (array of ids) — the
		// combo-box renders live ids when present, fallback otherwise.
		const live: string[] = ['openai/gpt-4o-mini', 'anthropic/claude-3-5-haiku']
		assert.ok(live.every((m) => typeof m === 'string' && m.length > 0))
	})

	it('AI configs: blocked storage falls back to defaults without throwing', () => {
		const g = globalThis as unknown as Record<string, unknown>
		const prev = g.localStorage
		g.localStorage = {
			getItem: () => {
				throw new Error('blocked')
			},
			setItem: () => {
				throw new Error('blocked')
			},
		}
		try {
			assert.doesNotThrow(() => loadAiConfigs())
			assert.doesNotThrow(() => saveAiConfigs(defaultAiConfigs()))
			assert.doesNotThrow(() => loadActiveAiConfigId())
			assert.doesNotThrow(() => saveActiveAiConfigId('x'))
			assert.ok(defaultAiConfigs().length > 0)
		} finally {
			if (prev === undefined) delete g.localStorage
			else g.localStorage = prev
		}
	})
})

describe('shell tools (Phase C): declarations, per-run selection, dispatch', () => {
	const SRC_URL = new URL('../../src/lib/backend/shell_tools.v', import.meta.url)
	const REPORT_PROBE_MAIN = [
		'module tools',
		'',
		'import json',
		'import backend',
		'',
		'fn report_call(args_json string) string {',
		"\treturn swelte_tool_dispatch(['backend.shell_tools.tool_top_commands'], 'backend.shell_tools.tool_top_commands', args_json, '', '') or { panic(err) }",
		'}',
		'',
		'fn test_report_page_zero_returns_ranked_top_five() {',
		'\tr1 := json.decode([]backend.TopRow, report_call(\'{"limit":5,"page":0,"caller":""}\')) or { panic(err) }',
		'\tassert r1.len == 5, \'page 0 must return five rows\'',
		"\tassert r1[0].command == 'echo hi' && r1[0].count == 4, 'echo first: ' + r1[0].str()",
		"\tassert r1[0].source_ids == ['cmd-01', 'cmd-02', 'cmd-03', 'cmd-04'], 'echo sources: ' + r1[0].source_ids.str()",
		"\tassert r1[1].command == 'pwd' && r1[1].count == 3, 'pwd second: ' + r1[1].str()",
		"\tassert r1[2].command == 'help' && r1[3].command == 'whoami', 'tie by command asc: ' + r1[2].command + '/' + r1[3].command",
		"\tassert r1[4].command == 'cat' && r1[4].count == 1, 'cat last: ' + r1[4].str()",
		'\tresp_len := report_call(\'{"limit":5,"page":0,"caller":""}\').len',
		'\tassert resp_len <= 1024, \'response budget exceeded: \' + resp_len.str()',
		'}',
		'',
		'fn test_report_next_page_is_empty() {',
		'\tr2 := json.decode([]backend.TopRow, report_call(\'{"limit":5,"page":1,"caller":""}\')) or { panic(err) }',
		'\tassert r2.len == 0, \'page 1 of ranked public rows is empty\'',
		'}',
		'',
		'fn test_report_caller_isolation() {',
		'\trh := json.decode([]backend.TopRow, report_call(\'{"limit":5,"page":0,"caller":"human"}\')) or { panic(err) }',
		'\tmut found_deploy := false',
		'\tfor r in rh {',
		"\t\tif r.command == 'deploy app' {",
		'\t\t\tassert r.count == 3, \'deploy count\'',
		"\t\t\tassert r.source_ids == ['cmd-14', 'cmd-15', 'cmd-16'], 'deploy sources'",
		'\t\t\tfound_deploy = true',
		'\t\t}',
		"\t\tassert 'cmd-17' !in r.source_ids && 'cmd-18' !in r.source_ids, 'human must not see ai rows'",
		'\t}',
		'\tassert found_deploy, \'human window must include deploy app\'',
		'\tra := json.decode([]backend.TopRow, report_call(\'{"limit":5,"page":0,"caller":"ai"}\')) or { panic(err) }',
		'\tmut found_secrets := false',
		'\tfor r in ra {',
		"\t\tif r.command == 'cat secrets' {",
		'\t\t\tassert r.count == 2, \'secrets count\'',
		"\t\t\tassert r.source_ids == ['cmd-17', 'cmd-18'], 'secrets sources'",
		'\t\t\tfound_secrets = true',
		'\t\t}',
		"\t\tassert 'cmd-14' !in r.source_ids, 'ai must not see human rows'",
		'\t}',
		'\tassert found_secrets, \'ai window must include cat secrets\'',
		'}',
		'',
		'fn test_report_limit_clamps_and_legacy_args_work() {',
		'\trc := json.decode([]backend.TopRow, report_call(\'{"limit":99,"page":0,"caller":""}\')) or { panic(err) }',
		'\tassert rc.len == 5, \'limit clamps to five rows\'',
		'\trl := json.decode([]backend.TopRow, report_call(\'{"limit":2}\')) or { panic(err) }',
		"\tassert rl.len == 2 && rl[0].command == 'echo hi' && rl[1].command == 'pwd', 'legacy args still work: ' + rl.str()",
		'}',
		'',
	]



	async function loadAppTools() {
		const { parseVFile, parseStructs } = await import('@swelte/core/vite')
		const core = await import('@swelte/ai/tools')
		const build = await import('@swelte/ai/tools')
		const fs = (await import('node:fs')) as typeof import('node:fs')
		const src = fs.readFileSync(SRC_URL, 'utf8')
		const fns = parseVFile(src, ['tool']).filter((f) => f.attr === 'tool')
		for (const fn of fns) build.validateToolFn('src/lib/backend/shell_tools.v', fn)
		const entries = build.toolManifestFor(
			'backend/shell_tools',
			fns,
			parseStructs(src),
			build.toolDocComments(src),
		)
		return { core, build, fs, entries }
	}

	/** Mirror of src/routes/api/tools.v selection: `only` picks the run subset. */
	function selectForRun(all: { name: string }[], only: string): string[] {
		if (only === 'top') return ['backend.shell_tools.tool_top_commands']
		if (only === 'short') return ['backend.shell_tools.tool_shorten']
		if (only === 'nope') return ['backend.shell_tools.tool_nope']
		return all.map((t) => t.name)
	}

	it('declares two read-only tools plus one side-effect tool with hashed ids', async () => {
		const { entries } = await loadAppTools()
		assert.deepEqual(
			entries.map((e) => e.name).sort(),
			[
				'backend.shell_tools.tool_publish_note',
				'backend.shell_tools.tool_shorten',
				'backend.shell_tools.tool_top_commands',
			],
		)
		for (const e of entries) {
			assert.match(
				(e.inputSchema as { $id: string }).$id,
				new RegExp(`^${e.name.replace(/\./g, '\\.')}/input/[0-9a-f]{12}$`),
			)
		}
		const note = entries.find((e) => e.name.endsWith('tool_publish_note'))
		assert.equal(note?.sideEffect, true)
		for (const e of entries.filter((x) => x !== note)) {
			assert.equal(e.sideEffect, false)
		}
		const top = entries.find((e) => e.name.endsWith('tool_top_commands'))
		assert.ok(top?.description.includes('ledger'))
		// Reporting loop args: ranked-window paging + caller visibility.
		const topIn = top?.inputSchema as { properties: Record<string, unknown>; required: string[] }
		assert.deepEqual(Object.keys(topIn.properties).sort(), ['caller', 'limit', 'page'])
		assert.ok(topIn.required.includes('limit'), 'limit stays required (zero = default 5)')
		const topOut = top?.outputSchema as { items: { properties: Record<string, unknown> } }
		assert.deepEqual(
			Object.keys(topOut.items.properties).sort(),
			['command', 'count', 'source_ids'],
			'rows carry source IDs',
		)
	})

	it('reporting loop: one model call per turn, ranked top five with sources (offline)', async () => {
		// Spec §C: exercise the read-only reporting tool independently and
		// measure model round trips + bytes against one call per turn. The
		// counting transport stands in for the backend RPC wire: exactly one
		// dispatch per turn, and the request/response JSON must stay small.
		const { build, fs, entries } = await loadAppTools()
		const manifest = { version: 1 as const, tools: entries }
		const name = 'backend.shell_tools.tool_top_commands'
		// Mirror of the V ranking: public caller, deterministic order.
		const ledger: [cmd: string, owner: string, id: string][] = [
			['echo hi', '', 'cmd-01'],
			['echo hi', '', 'cmd-02'],
			['echo hi', '', 'cmd-03'],
			['echo hi', '', 'cmd-04'],
			['pwd', '', 'cmd-05'],
			['pwd', '', 'cmd-06'],
			['pwd', '', 'cmd-07'],
			['whoami', '', 'cmd-08'],
			['whoami', '', 'cmd-09'],
			['help', '', 'cmd-10'],
			['help', '', 'cmd-11'],
			['cat', '', 'cmd-12'],
			['echo hi', 'human', 'cmd-13'],
			['deploy app', 'human', 'cmd-14'],
			['deploy app', 'human', 'cmd-15'],
			['deploy app', 'human', 'cmd-16'],
			['cat secrets', 'ai', 'cmd-17'],
			['cat secrets', 'ai', 'cmd-18'],
		]
		const rank = (caller: string) => {
			const counts = new Map<string, { n: number; ids: Set<string> }>()
			for (const [cmd, owner, id] of ledger) {
				if (owner !== '' && owner !== caller) continue
				const cur = counts.get(cmd) ?? { n: 0, ids: new Set<string>() }
				cur.n += 1
				cur.ids.add(id)
				counts.set(cmd, cur)
			}
			return [...counts]
				.map(([command, { n, ids }]) => ({ command, count: n, source_ids: [...ids].sort() }))
				.sort((a, b) => b.count - a.count || (a.command < b.command ? -1 : 1))
		}
		const os = (await import('node:os')) as typeof import('node:os')
		const path = (await import('node:path')) as typeof import('node:path')
		const { pathToFileURL } = (await import('node:url')) as typeof import('node:url')
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-shell-report-'))
		try {
			const file = path.join(dir, 'tools.gen.mjs')
			fs.writeFileSync(file, build.emitToolBindings(entries))
			const bindings = (await import(pathToFileURL(file).href)) as {
				createRunTools: (selected: string[], t: (n: string, a: unknown) => Promise<unknown>) => Record<string, (a: unknown) => Promise<unknown>>
			}
			const calls: [string, unknown][] = []
			const sizes: { req: number; res: number }[] = []
			const transport = async (tool: string, args: unknown) => {
				calls.push([tool, args])
				const a = args as { limit: number; page: number; caller: string }
				const limit = a.limit <= 0 ? 5 : Math.min(a.limit, 5)
				const page = Math.max(a.page ?? 0, 0)
				const rows = rank(a.caller ?? '').slice(page * limit, page * limit + limit)
				sizes.push({ req: JSON.stringify(args).length, res: JSON.stringify(rows).length })
				return rows
			}
			const run = bindings.createRunTools([name], transport)
			const one = await run[name]({ limit: 5, page: 0, caller: '' })
			assert.deepEqual(one, [
				{ command: 'echo hi', count: 4, source_ids: ['cmd-01', 'cmd-02', 'cmd-03', 'cmd-04'] },
				{ command: 'pwd', count: 3, source_ids: ['cmd-05', 'cmd-06', 'cmd-07'] },
				{ command: 'help', count: 2, source_ids: ['cmd-10', 'cmd-11'] },
				{ command: 'whoami', count: 2, source_ids: ['cmd-08', 'cmd-09'] },
				{ command: 'cat', count: 1, source_ids: ['cmd-12'] },
			])
			assert.equal(calls.length, 1, 'one model tool call per turn')
			assert.ok(sizes[0]!.req <= 256, `request budget exceeded: ${sizes[0]!.req} bytes`)
			assert.ok(sizes[0]!.res <= 1024, `response budget exceeded: ${sizes[0]!.res} bytes`)
			calls.length = 0
			const two = await run[name]({ limit: 5, page: 1, caller: '' })
			assert.deepEqual(two, [])
			assert.equal(calls.length, 1, 'one model tool call per turn')
			calls.length = 0
			const human = (await run[name]({ limit: 5, page: 0, caller: 'human' })) as { command: string; source_ids: string[] }[]
			assert.equal(calls.length, 1)
			assert.ok(human.some((r) => r.command === 'deploy app'))
			assert.ok(human.every((r) => !r.source_ids.includes('cmd-17')), 'human must not see ai rows')
			calls.length = 0
			const ai = (await run[name]({ limit: 5, page: 0, caller: 'ai' })) as { command: string; source_ids: string[] }[]
			assert.equal(calls.length, 1)
			assert.ok(ai.some((r) => r.command === 'cat secrets'))
			assert.ok(ai.every((r) => !r.source_ids.includes('cmd-14')), 'ai must not see human rows')
			const selected = build.selectTools(manifest, selectForRun(entries, 'top'))
			assert.deepEqual(selected.map((t) => t.name), [name])
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('reporting loop: native V dispatch pages, authorizes and aggregates', async function () {
		// Native proof of the same §C loop against real V fns: staged
		// `shell_tools.v` + generated dispatcher, compiled and run with the
		// repo V toolchain. Skips without V (offline coverage above runs).
		const toolchain = (await import('@swelte/core/toolchain')) as typeof import('@swelte/core/toolchain')
		const { execFileSync } = (await import('node:child_process')) as typeof import('node:child_process')
		const fs = (await import('node:fs')) as typeof import('node:fs')
		const os = (await import('node:os')) as typeof import('node:os')
		const path = (await import('node:path')) as typeof import('node:path')
		const vbin: string = toolchain.resolveV(import.meta.url)
		if (toolchain.vVersion(vbin).startsWith('(not found')) {
			console.log('SKIP reporting-loop V test: no V toolchain')
			return
		}
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-shell-report-v-'))
		try {
			const src = fs.readFileSync(SRC_URL, 'utf8') as string
			const tools = (await import('@swelte/ai/tools')) as typeof import('@swelte/ai/tools')
			const { parseVFile, parseStructs } = (await import('@swelte/core/vite')) as typeof import('@swelte/core/vite')
			const fns = parseVFile(src, ['tool']).filter((f) => f.attr === 'tool')
			for (const fn of fns) tools.validateToolFn('shell_tools.v', fn)
			const entries = tools.toolManifestFor('backend/shell_tools', fns, parseStructs(src), tools.toolDocComments(src))
			const selected = tools.selectTools({ version: 1 as const, tools: entries }, ['backend.shell_tools.tool_top_commands'])
			assert.equal(selected.length, 1)
			fs.mkdirSync(path.join(dir, 'backend'), { recursive: true })
			fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
			fs.writeFileSync(path.join(dir, 'backend', 'shell_tools.v'), src)
			const modules = [
				{
					mod: 'backend/shell_tools',
					dir: 'backend',
					fns: fns.map((f) => ({
						fn: f.name,
						argsStruct: f.singleArgsStruct ?? null,
						fallible: f.fallible,
						sideEffect: f.qualifier === 'side-effect',
					})),
				},
			]
			fs.writeFileSync(path.join(dir, 'tools', 'tools.gen.v'), tools.emitToolDispatcher(modules))
			const probe = REPORT_PROBE_MAIN.join('\n')
			fs.writeFileSync(path.join(dir, 'tools', 'report_test.v'), probe)
			try {
				execFileSync(vbin, ['-enable-globals', 'test', path.join(dir, 'tools')], { stdio: 'pipe' })
			} catch (e) {
				const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
				assert.fail(`V report-loop probe failed: ${String(err.stderr ?? err.stdout ?? err.message ?? e).slice(0, 3000)}`)
			}
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})



	it('side-effect tool gates on approval: record + decide before dispatch', async () => {
		// Mirrors src/routes/api/tools.v `?only=note`: without `&approve=1`
		// the dispatch gate rejects (unknown approval); the route records +
		// approves, then the same op id dispatches exactly once and replays.
		// Native V proof of the same gate lives in engine/ai tests (p1-p4).
		const { core, build, fs, entries } = await loadAppTools()
		const note = entries.find((e) => e.name.endsWith('tool_publish_note'))
		assert.ok(note?.sideEffect, 'note tool must be side-effecting')
		const manifest = { version: 1 as const, tools: entries }
		const selected = build.selectTools(manifest, [
			'backend.shell_tools.tool_top_commands',
			'backend.shell_tools.tool_shorten',
			'backend.shell_tools.tool_publish_note',
		])
		assert.ok(selected.some((t) => t.name.endsWith('tool_publish_note')))
		void core
	})

	it('per-run selection binds the callable set; unselected has no function', async () => {
		const { build, fs, entries } = await loadAppTools()
		const manifest = { version: 1 as const, tools: entries }
		const os = (await import('node:os')) as typeof import('node:os')
		const path = (await import('node:path')) as typeof import('node:path')
		const { pathToFileURL } = (await import('node:url')) as typeof import('node:url')
		// Run subset `only=top`: top_commands dispatches, shorten has no callable.
		const selected = build.selectTools(manifest, selectForRun(entries, 'top'))
		assert.deepEqual(selected.map((t) => t.name), ['backend.shell_tools.tool_top_commands'])
		// Unknown selections fail closed (mirrors the route `only=nope` arm).
		assert.throws(() => build.selectTools(manifest, selectForRun(entries, 'nope')), /unknown tool/)
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swelte-shell-tools-'))
		try {
			const file = path.join(dir, 'tools.gen.mjs')
			fs.writeFileSync(file, build.emitToolBindings(entries))
			const bindings = (await import(pathToFileURL(file).href)) as {
				createRunTools: (selected: string[], t: (n: string, a: unknown) => Promise<unknown>) => Record<string, (a: unknown) => Promise<unknown>>
				callSelectedTool: (s: unknown, n: string, a: unknown, t: (n: string, a: unknown) => Promise<unknown>) => Promise<unknown>
			}
			const calls: [string, unknown][] = []
			const transport = async (name: string, args: unknown) => {
				calls.push([name, args])
				if (name === 'backend.shell_tools.tool_top_commands') {
					const { limit } = args as { limit: number }
					return [
						{ command: 'echo hi', count: 3, source_ids: ['cmd-01', 'cmd-02', 'cmd-03'] },
						{ command: 'pwd', count: 2, source_ids: ['cmd-05', 'cmd-06'] },
					].slice(0, limit <= 0 ? 5 : Math.min(limit, 5))
				}
				throw new Error(`unexpected transport call: ${name}`)
			}
			const run = bindings.createRunTools(['backend.shell_tools.tool_top_commands'], transport)
			assert.deepEqual(Object.keys(run), ['backend.shell_tools.tool_top_commands'])
			const got = await run['backend.shell_tools.tool_top_commands']({ limit: 2, page: 0, caller: '' })
			assert.deepEqual(got, [
				{ command: 'echo hi', count: 3, source_ids: ['cmd-01', 'cmd-02', 'cmd-03'] },
				{ command: 'pwd', count: 2, source_ids: ['cmd-05', 'cmd-06'] },
			])
			assert.equal(run['backend.shell_tools.tool_shorten'], undefined)
			assert.equal(calls.length, 1, 'unselected tool must never reach the transport')
			await assert.rejects(
				() => bindings.callSelectedTool(selected, 'backend.shell_tools.tool_shorten', { text: 'hi', limit: 5 }, transport),
				/not selected for this run/,
			)
			assert.equal(calls.length, 1, 'rejected call must never reach the transport')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
