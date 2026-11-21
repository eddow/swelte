// Direct OpenAI adapter: second real network `AiAdapter` with a different
// capability set from OpenRouter (OpenAI Responses SSE, native `store`d
// usage reporting). Proves the text consumer switches providers by config.

import type { AiAdapter } from './adapters.js'
import type { AdapterCaps, RunRequirements } from './capabilities.js'
import type { RunTerminalReason } from './envelope.js'
import type { WireEvent } from './sse.js'
import type { PriceTable, ProviderUsage, TraceEvent, TraceSink } from './trace.js'
import { estimateCost } from './trace.js'

export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export interface OpenAiConfig {
	apiKey: string
	model: string
	allowlist?: string[]
	baseUrl?: string
	latencyMs?: number
	/** Optional price table (per 1k tokens) — no table means unknown cost. */
	pricing?: PriceTable
	/** Pre-run routing ceiling: worst-case 1k-token blend of the table. */
	maxCostPer1k?: number
	onEvent?: (event: TraceEvent) => void
	sink?: TraceSink
	fetch?: typeof fetch
}

export interface OpenAiRunOptions {
	system?: string
	maxTokens?: number
	temperature?: number
	signal?: AbortSignal
}

/** Responses-SSE event: text delta, completion, or stored-usage report. */
export interface OpenAiStreamEvent {
	type?: string
	delta?: string
	response?: { usage?: { input_tokens?: number; output_tokens?: number } }
}

export const OPENAI_CAPS: AdapterCaps = {
	input: { modalities: ['text'], encodings: ['utf-8'], duplex: false, stream: false },
	output: { modalities: ['text'], encodings: ['utf-8'], duplex: false, stream: true },
	structuredOutput: false,
	toolCalls: false,
	usageReporting: true,
	cancellation: true,
}

/** Model + requirements gate: runs before any network. */
export function checkOpenAiFit(
	requirements: RunRequirements,
	config: Pick<OpenAiConfig, 'model' | 'allowlist'>
): string | null {
	if (config.allowlist && !config.allowlist.includes(config.model))
		return `openai: model ${config.model} not in allowlist`
	const need = [...requirements.input, ...requirements.output]
	if (need.some((m) => m !== 'text')) return 'openai: text-only adapter, run needs more'
	if (requirements.toolCalls) return 'openai: adapter does not support tool calls'
	if (requirements.structuredOutput) return 'openai: adapter does not support structured output'
	return null
}

function assertModel(config: OpenAiConfig): void {
	if (!config.apiKey) throw new Error('openai: apiKey required (server env OPENAI_API_KEY)')
	if (!config.model) throw new Error('openai: model required')
	if (config.allowlist && !config.allowlist.includes(config.model))
		throw new Error(`openai: model ${config.model} not in allowlist`)
}

function toUsage(ev: OpenAiStreamEvent): ProviderUsage | undefined {
	const u = ev.response?.usage
	if (!u) return undefined
	return {
		...(u.input_tokens !== undefined ? { inputTokens: u.input_tokens } : {}),
		...(u.output_tokens !== undefined ? { outputTokens: u.output_tokens } : {}),
	}
}

async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
	const reader = res.body?.getReader()
	if (!reader) throw new Error('openai: empty response body')
	const decoder = new TextDecoder()
	let buf = ''
	for (;;) {
		if (signal?.aborted) {
			await reader.cancel().catch(() => {})
			throw new Error('openai: cancelled')
		}
		const { done, value } = await reader.read()
		buf += decoder.decode(value ?? new Uint8Array(), { stream: !done })
		let idx: number
		while ((idx = buf.indexOf('\n')) >= 0) {
			yield buf.slice(0, idx).trimEnd()
			buf = buf.slice(idx + 1)
		}
		if (done) {
			if (buf.trim()) yield buf.trim()
			return
		}
	}
}

export class OpenAiAdapter implements AiAdapter {
	name = 'openai'
	readonly model: string
	readonly latencyMs: number
	readonly pricing: PriceTable | undefined
	readonly maxCostPer1k: number | undefined
	readonly caps = OPENAI_CAPS
	private config: OpenAiConfig

	constructor(config: OpenAiConfig) {
		assertModel(config)
		this.config = config
		this.model = config.model
		this.latencyMs = config.latencyMs ?? 0
		this.pricing = config.pricing
		this.maxCostPer1k = config.maxCostPer1k
	}

	async *run(
		input: string,
		requirements: RunRequirements,
		opts: OpenAiRunOptions = {}
	): AsyncIterable<WireEvent> {
		const unfit = checkOpenAiFit(requirements, this.config)
		if (unfit) throw new Error(unfit)
		const runId = `run-openai-${Date.now().toString(36)}`
		const outputId = 'out-text'
		const emit = this.config.onEvent ?? this.config.sink?.record.bind(this.config.sink)
		let seq = 0
		const trace = (event: TraceEvent) => emit?.(event)
		const res = await (this.config.fetch ?? fetch)(
			`${this.config.baseUrl ?? OPENAI_BASE_URL}/responses`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${this.config.apiKey}`,
				},
				body: JSON.stringify({
					model: this.config.model,
					stream: true,
					input: [
						...(opts.system ? [{ role: 'system', content: opts.system }] : []),
						{ role: 'user', content: input },
					],
					...(opts.maxTokens !== undefined ? { max_output_tokens: opts.maxTokens } : {}),
					...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
				}),
				signal: opts.signal,
			}
		)
		if (!res.ok) throw new Error(`openai: HTTP ${res.status}`)
		let usage: ProviderUsage | undefined
		let terminal: RunTerminalReason = 'completed'
		try {
			for await (const line of sseLines(res, opts.signal)) {
				if (!line.startsWith('data:')) continue
				const data = line.slice(5).trim()
				if (data === '[DONE]') break
				let ev: OpenAiStreamEvent
				try {
					ev = JSON.parse(data) as OpenAiStreamEvent
				} catch {
					continue
				}
				const u = toUsage(ev)
				if (u) usage = { ...usage, ...u }
				if (ev.delta) {
					seq += 1
					trace({ runId, outputId, seq, kind: 'text.delta', usage })
					yield {
						envelope: { runId, outputId, kind: 'text.delta', seq },
						payload: { text: ev.delta },
					}
				}
				if (ev.type === 'response.failed' || ev.type === 'response.incomplete') terminal = 'failed'
			}
		} catch (e) {
			if (opts.signal?.aborted || (e as Error).message.includes('cancelled')) terminal = 'cancelled'
			else throw e
		}
		seq += 1
		const estimatedCost = estimateCost(usage, this.pricing)
		trace({ runId, outputId, seq, kind: 'terminal', usage, ...(estimatedCost ? { estimatedCost } : {}), terminal })
		yield {
			envelope: { runId, outputId, kind: 'terminal', seq },
			payload: { reason: terminal, ...(usage ? { usage } : {}) },
		}
	}
}

/** Build from server env. Throws when the key is missing. */
export function openAiFromEnv(
	env: Record<string, string | undefined>,
	opts: Omit<OpenAiConfig, 'apiKey'> & { keyEnv?: string }
): OpenAiAdapter {
	const name = opts.keyEnv ?? 'OPENAI_API_KEY'
	const key = env[name]
	if (!key) throw new Error(`openai: missing ${name} (server env only)`)
	const { keyEnv: _ignored, ...rest } = opts
	return new OpenAiAdapter({ ...rest, apiKey: key })
}
