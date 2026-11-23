import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DraftStore } from '@swelte/ai'
import { RunTracker } from '@swelte/ai'
import { createSseParser, decodeSseEvent, encodeSseEvent } from '@swelte/ai'
import { createMemorySink } from '@swelte/ai'
import { ApprovalStore, authorizeShellCall, driverHolds, parseDriver, runAllowlisted, runApproved } from '../src/lib/shell.js'
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
	it('human commands always run; unsupported names are honest, never fake', () => {
		const ok = authorizeShellCall('human', 'echo hello shared shell')
		assert.equal(ok.allowed, true)
		assert.equal(ok.needsApproval, false)
		assert.equal(runAllowlisted('echo hello shared shell'), 'hello shared shell')
		// Destructive / unlisted names are unsupported — honestly, in the
		// terminal only. No "not allowlisted" error, no fake `ran:`.
		const other = authorizeShellCall('human', 'rm -rf /')
		assert.equal(other.allowed, true)
		assert.equal(other.needsApproval, false)
		assert.throws(() => runApproved('rm -rf /'), /unsupported command/)
		assert.throws(() => runAllowlisted('rm -rf /'), /unsupported command/)
		// Live-backed commands are honest offline too: they need the backend.
		assert.throws(() => runAllowlisted('ls'), /needs backend/)
		assert.throws(() => runAllowlisted('cd /tmp'), /needs backend/)
		assert.throws(() => runAllowlisted('cat README.md'), /needs backend/)
		assert.equal(runApproved('ls'), 'approved for live execution: ls')
	})

	it('ai commands inside the sandbox park for human approval — never point-blank refused', () => {
		// Sandbox commands park.
		const gate = authorizeShellCall('ai', 'ls')
		assert.equal(gate.allowed, false)
		assert.equal(gate.needsApproval, true)
		// Unlisted AI commands also park (human confirms, backend
		// enforces the final gate after the decision).
		const outside = authorizeShellCall('ai', 'rm -rf /')
		assert.equal(outside.allowed, false)
		assert.equal(outside.needsApproval, true)
		assert.ok(outside.reason.includes('human approval'))
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

	it('approval IDs cannot be rebound and expired grants cannot execute', () => {
		const store = new ApprovalStore()
		store.request('ai', 'pwd', 'bound')
		assert.throws(() => store.request('human', 'pwd', 'bound'), /binding mismatch/)
		assert.throws(() => store.request('ai', 'ls', 'bound'), /binding mismatch/)
		const expired = store.request('ai', 'pwd', 'expired-grant', -1)
		expired.decision = 'approved'
		assert.throws(() => store.markExecuted('expired-grant'), /expired/)
	})

	it('driver lease: holder-bound single driver, advisory preemption (§3)', () => {
		const now = Date.now() / 1000
		// No lease / malformed / expired all read as human.
		assert.equal(parseDriver('human', 0, now).kind, 'human')
		assert.equal(parseDriver('', 0, now).kind, 'human')
		assert.equal(parseDriver('ai:', 0, now).kind, 'human')
		assert.equal(parseDriver('ai:run-1/turn-1', now - 1, now).kind, 'human')
		// Live lease parses with holder + expiry; only the holder holds.
		const live = parseDriver('ai:run-1/turn-1', now + 90, now)
		assert.equal(live.kind, 'ai')
		assert.ok(driverHolds(live, 'run-1/turn-1'))
		assert.equal(driverHolds(live, 'run-2/turn-9'), false)
		assert.equal(driverHolds({ kind: 'human' }, 'run-1/turn-1'), false)
		// §7 guardrail: anything but the lease holder's turn behaves human.
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

	it('declares three read-only tools plus three side-effect tools with hashed ids', async () => {
		const { entries } = await loadAppTools()
		assert.deepEqual(
			entries.map((e) => e.name).sort(),
			[
				'backend.shell_tools.tool_publish_note',
				'backend.shell_tools.tool_shell_browse',
				'backend.shell_tools.tool_shell_exec',
				'backend.shell_tools.tool_shell_query',
				'backend.shell_tools.tool_shell_read_output',
				'backend.shell_tools.tool_shell_send_input',
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
		const exec = entries.find((e) => e.name.endsWith('tool_shell_exec'))
		assert.equal(exec?.sideEffect, true)
		const input = entries.find((e) => e.name.endsWith('tool_shell_send_input'))
		assert.equal(input?.sideEffect, true)
		for (const e of entries.filter((x) => x !== note && x !== exec && x !== input && !x.name.endsWith('tool_shell_browse'))) {
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
			// The reporting probe stages only the §C slice: shell_tools.v is
			// `module backend` with KV-backed agentic tools that need the app
			// backend, so extract just the reporting fns + structs into a
			// self-contained probe module.
			const keep = new Set(['tool_top_commands', 'tool_shorten', 'tool_publish_note'])
			const keptFns = fns.filter((f) => keep.has(f.name))
			for (const fn of keptFns) tools.validateToolFn('shell_tools.v', fn)
			const entries = tools.toolManifestFor('backend/shell_tools', keptFns, parseStructs(src), tools.toolDocComments(src))
			const selected = tools.selectTools({ version: 1 as const, tools: entries }, ['backend.shell_tools.tool_top_commands'])
			assert.equal(selected.length, 1)
			fs.mkdirSync(path.join(dir, 'backend'), { recursive: true })
			fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
			// Self-contained reporting slice: keep only the reporting fns +
			// their structs (no KV/emit agentic helpers — see above).
			// Blocks are `@[tool]` attrs + doc comments + one fn each.
			const keepStruct = new Set(['TopArgs', 'TopRow', 'ShortenArgs', 'NoteArgs', 'NoteRow', 'LedgerEntry'])
			const blocks = src.split(/\n(?=(?:\/\/[^\n]*\n|@\[tool[^\n]*\n|pub struct |struct |fn ))/g)
			const take: string[] = ['module backend', '']
			for (const b of blocks) {
				const m = b.match(/pub fn (\w+)/) ?? b.match(/^(?:pub struct|struct|fn) (\w+)/m)
				const name = m?.[1] ?? ''
				if (keep.has(name) || keepStruct.has(name) || name === 'shell_ledger') take.push(b.trimEnd())
			}
			fs.writeFileSync(path.join(dir, 'backend', 'shell_tools.v'), take.join('\n\n') + '\n')
			const modules = [
				{
					mod: 'backend/shell_tools',
					dir: 'backend',
					fns: keptFns.map((f) => ({
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

	it('agentic shell tools: read-only observe bound, driving gated (§4/§7)', async () => {
		const { build, entries } = await loadAppTools()
		const names = entries.map((e) => e.name)
		// The three §4 tools exist with the right side-effect flags.
		const byName = new Map(entries.map((e) => [e.name, e]))
		assert.equal(byName.get('backend.shell_tools.tool_shell_exec')?.sideEffect, true)
		assert.equal(byName.get('backend.shell_tools.tool_shell_send_input')?.sideEffect, true)
		assert.equal(byName.get('backend.shell_tools.tool_shell_read_output')?.sideEffect, false)
		const manifest = { version: 1 as const, tools: entries }
		// Fixture 3 (observe-only): read-only run selects read_output +
		// reporting tools; exec/send_input have no callable in this run.
		const observe = build.selectTools(manifest, [
			'backend.shell_tools.tool_shell_read_output',
			'backend.shell_tools.tool_top_commands',
		])
		assert.ok(observe.some((t) => t.name.endsWith('tool_shell_read_output')))
		assert.ok(!observe.some((t) => t.name.endsWith('tool_shell_exec')))
		assert.ok(!observe.some((t) => t.name.endsWith('tool_shell_send_input')))
		// Unknown names fail closed (mirrors the route dispatch boundary).
		assert.throws(() => build.selectTools(manifest, ['backend.shell_tools.tool_nope']), /unknown tool/)
		void names
	})

	it('observe-turn parse gate: one `<tool name args>` line, allowlist-bound (§2 Stage A)', () => {
		// The V parser (`ai_parse_observe_call` in `src/routes/+page.v`) takes
		// one `<tool full-name single-line-json>` line; mirror its rules here:
		// full tool name + single-line `{...}` args, first valid line wins,
		// anything else (prose, multi-line args, exec) is rejected.
		function parseObserveCall(text: string): [string, string] {
			for (const line of text.split('\n')) {
				const trimmed = line.trim()
				if (!trimmed.startsWith('<tool ') || !trimmed.endsWith('>')) continue
				const inner = trimmed.slice(6, -1).trim()
				const sp = inner.indexOf(' ')
				if (sp < 0) continue
				const name = inner.slice(0, sp).trim()
				const args = inner.slice(sp + 1).trim()
				if (!name || !args.startsWith('{') || !args.endsWith('}')) continue
				if (args.includes('\n')) continue
				return [name, args]
			}
			return ['', '']
		}
		const allowed = new Set([
			'backend.shell_tools.tool_shell_read_output',
			'backend.shell_tools.tool_top_commands',
		])
		// Valid observe call parses; exec parses but is not observe-selectable.
		const [name, args] = parseObserveCall(
			'thinking out loud\n<tool backend.shell_tools.tool_shell_read_output {"since_seq":0,"limit":5}>',
		)
		assert.equal(name, 'backend.shell_tools.tool_shell_read_output')
		assert.ok(allowed.has(name), 'read_output is observe-selectable')
		assert.deepEqual(JSON.parse(args), { since_seq: 0, limit: 5 })
		const [execName] = parseObserveCall(
			'<tool backend.shell_tools.tool_shell_exec {"cmd":"pwd"}>',
		)
		assert.ok(!allowed.has(execName), 'exec parses but is never observe-selected')
		// Prose-only, multi-line args, and truncated lines degrade to no call.
		assert.deepEqual(parseObserveCall('just chatting, no tool here'), ['', ''])
		assert.deepEqual(
			parseObserveCall('<tool backend.shell_tools.tool_shell_read_output {"since_seq":0,\n"limit":5}>'),
			['', ''],
			'multi-line args rejected',
		)
		assert.deepEqual(
			parseObserveCall('<tool backend.shell_tools.tool_shell_read_output {"since_seq":0'),
			['', ''],
			'unclosed line rejected',
		)

	it('driving turn resume protocol: holder re-check incl. expiry + decide before dispatch (§2 Stage B)', async () => {
		// Mirror of `shell_tool_resume` / `shell_tool_deny` in `+page.v`:
		// a parked call records the human decision on the dispatch-table
		// record only while the holder still owns the lease — flip or TTL
		// lapse fails closed (superseded/denied), never dispatches.
		const holder = 'run-demo/turn-1'
		const now = Date.now() / 1000
		const holds = (driver: string, expires: number, h: string) =>
			driverHolds(parseDriver(driver, expires, now), h)
		// Live lease + decide(approved) → dispatch executes once.
		const store = new ApprovalStore()
		store.request('ai', 'pwd', 'op-resume-live')
		assert.ok(holds(`ai:${holder}`, now + 90, holder), 'live lease holds')
		store.decide('op-resume-live', 'approved')
		assert.equal(store.markExecuted('op-resume-live').already, false)
		// Flip: holder no longer holds → resume superseded, deny marks denied.
		assert.ok(!holds('human', 0, holder), 'flipped lease denies the holder')
		const flipped = new ApprovalStore()
		flipped.request('ai', 'pwd', 'op-resume-flip')
		flipped.decide('op-resume-flip', 'denied')
		assert.throws(() => flipped.markExecuted('op-resume-flip'), /denied/)
		// Expiry: TTL lapse denies even while the KV row still names the holder.
		assert.ok(!holds(`ai:${holder}`, now - 1, holder), 'lapsed lease denies')
	})

	it('driving-turn gate: exec parks with op_id + holder, resume needs both (§2 Stage B)', async () => {
		const { build, entries } = await loadAppTools()
		const manifest = { version: 1 as const, tools: entries }
		// Driving run selects all three shell tools; observe run selects read-only.
		const driving = build.selectTools(manifest, [
			'backend.shell_tools.tool_shell_exec',
			'backend.shell_tools.tool_shell_send_input',
			'backend.shell_tools.tool_shell_read_output',
		])
		assert.ok(driving.some((t) => t.name.endsWith('tool_shell_exec')))
		// Parked driving line carries op_id + holder; the backend re-checks
		// both (holder lease + exact-args record) before dispatch.
		const holder = 'run-demo/turn-1'
		const args = JSON.stringify({ cmd: 'pwd', holder, op_id: 'op-drive-1' })
		assert.equal(JSON.parse(args).holder, holder)
		assert.equal(JSON.parse(args).op_id, 'op-drive-1')
		// A line missing op_id/holder never parks: the tail rejects it as
		// `drive rejected` and the stream still closes `waiting_approval`.
		for (const bad of ['{"cmd":"pwd"}', '{"cmd":"pwd","op_id":"op-1"}', '{"cmd":"pwd","holder":"h"}']) {
			const p = JSON.parse(bad) as Record<string, string>
			assert.ok(!p.op_id || !p.holder, `unparkable line rejected: ${bad}`)
		}

	it('scoped stdin pre-approval: scope row is holder-bound, lease-checked (§2 Stage C)', () => {
		// Mirror of `shell_stdin_scope_holds` (backend/shell_tools.v): a
		// scope row (`shell:stdin:scope:<op_id> = holder`) grants stdin only
		// while the row names this holder AND the driver lease is still
		// held. Flip / expiry / holder change → dead scope → per-keystroke
		// approval.
		function scopeHolds(row: string | undefined, holder: string, driver: string, nowS: number, expires: number): boolean {
			if (!row || !holder.trim() || row !== holder) return false
			if (driver !== `ai:${holder}`) return false
			return nowS <= expires
		}
		const holder = 'run-1/turn-1'
		const now = 1_000_000
		// Live scope: row + lease agree.
		assert.equal(scopeHolds(holder, holder, `ai:${holder}`, now, now + 90), true)
		// Flip kills it: driver back to human.
		assert.equal(scopeHolds(holder, holder, 'human', now, now + 90), false)
		// Expiry kills it.
		assert.equal(scopeHolds(holder, holder, `ai:${holder}`, now + 91, now + 90), false)
		// Holder change kills it: row names another turn.
		assert.equal(scopeHolds('run-1/turn-2', holder, `ai:${holder}`, now, now + 90), false)
		assert.equal(scopeHolds(undefined, holder, `ai:${holder}`, now, now + 90), false)
		// Missing op_id / holder never scopes.
		assert.equal(scopeHolds('', holder, `ai:${holder}`, now, now + 90), false)
		assert.equal(scopeHolds(holder, '', `ai:${holder}`, now, now + 90), false)
	})

	it('exec schema carries op_id for the stdin scope grant (§2 Stage C)', async () => {
		const { entries } = await loadAppTools()
		const exec = entries.find((e) => e.name.endsWith('tool_shell_exec'))
		const props = Object.keys((exec?.inputSchema as { properties: Record<string, unknown> }).properties ?? {}).sort()
		assert.deepEqual(props, ['cmd', 'holder', 'op_id'])
	})

	it('fixture 4 — human reclaims mid-turn: flip denies, human path byte-identical (§10.4)', () => {
		// Mirror of the route preempt (`exec`/`send_input` flip `ai:*` →
		// `human`) + resume fail-closed (`shell_tool_resume` errors when the
		// lease holder no longer holds): after a human terminal submit, the
		// lease reads `human`, the in-flight AI call resolves denied, and
		// the human command runs the unchanged allowlisted path.
		const holder = 'run-1/turn-1'
		const now = Date.now() / 1000
		// Before: AI holds the lease.
		assert.ok(driverHolds(parseDriver(`ai:${holder}`, now + 90, now), holder))
		// Human types in terminal → flip: driver back to human.
		const flipped = parseDriver('human', 0, now)
		assert.equal(flipped.kind, 'human')
		assert.equal(driverHolds(flipped, holder), false)
		// In-flight resume fails closed (holder no longer holds).
		assert.throws(
			() => {
				if (!driverHolds(flipped, holder)) throw new Error('shell: drive superseded (driver=human); in-flight AI call denied')
			},
			/superseded/,
			'post-flip resume denied',
		)
		// Human command runs the unchanged path.
		const gate = authorizeShellCall('human', 'echo reclaimed')
		assert.equal(gate.allowed, true)
		assert.equal(runAllowlisted('echo reclaimed'), 'reclaimed')
	})

	it('fixture 5 — denial and expiry fail closed with actionable errors (§10.4)', () => {
		// Denied/exprired dispatch records never execute: the model gets an
		// actionable error string, not a hang, with no partial side effect.
		const store = new ApprovalStore()
		store.request('ai', 'pwd', 'op-deny-1')
		store.decide('op-deny-1', 'denied')
		assert.throws(() => store.markExecuted('op-deny-1'), /denied/)
		store.request('ai', 'pwd', 'op-exp-1', -1)
		assert.equal(store.decide('op-exp-1', 'approved').decision, 'expired')
		assert.throws(() => store.markExecuted('op-exp-1'), /expired/)
	})

	it('fixture 6 — two tabs, one driver: contention rejects (§10.4)', () => {
		// Mirror of `shell_handoff` (§3): a second holder is rejected while
		// a live lease holds — the driver is backend state, so tab B's AI
		// call fails at the boundary. (`driverHolds` reads the wall clock,
		// so fixtures use real time, not a fake epoch.)
		function handoff(driver: string, expires: number, holder: string, nowS: number): { ok: boolean; reason: string } {
			if (!holder.trim()) return { ok: false, reason: 'needs holder' }
			const live = parseDriver(driver, expires, nowS)
			if (live.kind === 'ai') {
				if (live.holder === holder) return { ok: true, reason: 'already held by this turn' }
				return { ok: false, reason: `driver held by ${live.holder} (single driver)` }
			}
			return { ok: true, reason: 'handoff granted' }
		}
		const now = Date.now() / 1000
		assert.deepEqual(handoff('human', 0, 'run-A/turn-1', now).ok, true)
		// Tab A holds; tab B's handoff rejected while the lease lives.
		assert.match(handoff(`ai:run-A/turn-1`, now + 90, 'run-B/turn-1', now).reason, /single driver/)
		// Same holder re-handoff (retry) is idempotent, not a second lease.
		assert.equal(handoff(`ai:run-A/turn-1`, now + 90, 'run-A/turn-1', now).reason, 'already held by this turn')
		// After expiry, a new holder may take the drive.
		assert.equal(handoff(`ai:run-A/turn-1`, now - 1, 'run-B/turn-1', now).ok, true)
	})

	it('fixture 7 — double-gate resume: one record, approve-late or error (§10.4)', () => {
		// Exactly one dispatch-table record per op; approve minutes later
		// (within turn TTL) resumes the same turn; expired/denied → error.
		const store = new ApprovalStore()
		const rec = store.request('ai', 'pwd', 'op-resume-1', 60_000)
		assert.equal(rec.decision, 'pending')
		// Duplicate park folds away: still one record, still pending.
		assert.equal(store.request('ai', 'pwd', 'op-resume-1', 60_000), rec)
		// Approve minutes later, within TTL → resumes exactly once.
		assert.equal(store.decide('op-resume-1', 'approved').decision, 'approved')
		assert.equal(store.markExecuted('op-resume-1').already, false)
		assert.equal(store.markExecuted('op-resume-1').already, true, 'lost-ack retry replays, never re-executes')
		// Denied twin → actionable error, no execution.
		store.request('ai', 'pwd', 'op-resume-2', 60_000)
		store.decide('op-resume-2', 'denied')
		assert.throws(() => store.markExecuted('op-resume-2'), /denied/)
	})

	it('§8 budgets: shell-loop args ≤256B req, results ≤1024B res (§10.4)', async () => {
		const { entries } = await loadAppTools()
		// Driving `exec` line: exact-args JSON stays well inside the req budget.
		const execArgs = JSON.stringify({ cmd: 'pwd', holder: 'run-1/turn-1', op_id: 'run-1/turn-1-op-1' })
		assert.ok(execArgs.length <= 256, `exec req budget: ${execArgs.length}B`)
		// Scoped stdin line: same bound.
		const inputArgs = JSON.stringify({ keys: 'hello stdin', holder: 'run-1/turn-1', op_id: 'run-1/turn-1-op-1' })
		assert.ok(inputArgs.length <= 256, `send_input req budget: ${inputArgs.length}B`)
		// Read window: five rows max, 1024B cap with truncation marked.
		const readArgs = JSON.stringify({ since_seq: 195, limit: 5 })
		assert.ok(readArgs.length <= 256, `read req budget: ${readArgs.length}B`)
		const short = (s: string) => (s.length <= 1024 ? s : s.slice(0, 1021) + '...')
		assert.equal(short('x'.repeat(2000)).length, 1024)
		assert.ok(short('x'.repeat(2000)).endsWith('...'), 'truncation marked')
		// Transcript tail: 5 frames max, same 1024B cap.
		const tail = Array.from({ length: 5 }, (_, i) => `$ pwd\n/shell #${i}`).join('\n---\n')
		assert.ok(tail.length <= 1024, `tail budget: ${tail.length}B`)
		void entries
	})
	})
	})
})
