// Direct Anthropic adapter: third network adapter. Native Messages SSE
// (no tool use in this slice), provider-reported usage, cancellation.
// Together with OpenRouter + OpenAI it proves routing by capability.

import type { AiAdapter } from './adapters.js'
import type { AdapterCaps, RunRequirements } from './capabilities.js'
import type { RunTerminalReason } from './envelope.js'
import type { WireEvent } from './sse.js'
import type { PriceTable, ProviderUsage, TraceEvent, TraceSink } from './trace.js'
import { estimateCost } from './trace.js'

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
export const ANTHROPIC_VERSION = '2023-06-01'

export interface AnthropicConfig {
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

export interface AnthropicRunOptions {
	system?: string
	maxTokens?: number
	temperature?: number
	signal?: AbortSignal
}

/** Native Messages SSE event subset used here. */
export interface AnthropicStreamEvent {
	type?: string
	delta?: { type?: string; text?: string }
	usage?: { input_tokens?: number; output_tokens?: number }
	message?: { usage?: { input_tokens?: number; output_tokens?: number } }
}

export const ANTHROPIC_CAPS: AdapterCaps = {
	input: { modalities: ['text'], encodings: ['utf-8'], duplex: false, stream: false },
	output: { modalities: ['text'], encodings: ['utf-8'], duplex: false, stream: true },
	structuredOutput: false,
	toolCalls: false,
	usageReporting: true,
	cancellation: true,
}

/** Model + requirements gate: runs before any network. */
export function checkAnthropicFit(
	requirements: RunRequirements,
	config: Pick<AnthropicConfig, 'model' | 'allowlist'>
): string | null {
	if (config.allowlist && !config.allowlist.includes(config.model))
		return `anthropic: model ${config.model} not in allowlist`
	const need = [...requirements.input, ...requirements.output]
	if (need.some((m) => m !== 'text')) return 'anthropic: text-only adapter, run needs more'
	if (requirements.toolCalls) return 'anthropic: adapter does not support tool calls'
	if (requirements.structuredOutput) return 'anthropic: adapter does not support structured output'
	return null
}

function toUsage(ev: AnthropicStreamEvent): ProviderUsage | undefined {
	const u = ev.message?.usage ?? ev.usage
	if (!u) return undefined
	return {
		...(u.input_tokens !== undefined ? { inputTokens: u.input_tokens } : {}),
		...(u.output_tokens !== undefined ? { outputTokens: u.output_tokens } : {}),
	}
}

async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
	const reader = res.body?.getReader()
	if (!reader) throw new Error('anthropic: empty response body')
	const decoder = new TextDecoder()
	let buf = ''
	for (;;) {
		if (signal?.aborted) {
			await reader.cancel().catch(() => {})
			throw new Error('anthropic: cancelled')
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

export class AnthropicAdapter implements AiAdapter {
	name = 'anthropic'
	readonly model: string
	readonly latencyMs: number
	readonly pricing: PriceTable | undefined
	readonly maxCostPer1k: number | undefined
	readonly caps = ANTHROPIC_CAPS
	private config: AnthropicConfig

	constructor(config: AnthropicConfig) {
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
		opts: AnthropicRunOptions = {}
	): AsyncIterable<WireEvent> {
		const unfit = checkAnthropicFit(requirements, this.config)
		if (unfit) throw new Error(unfit)
		const runId = `run-anthropic-${Date.now().toString(36)}`
		const outputId = 'out-text'
		const emit = this.config.onEvent ?? this.config.sink?.record.bind(this.config.sink)
		let seq = 0
		const trace = (event: TraceEvent) => emit?.(event)
		const res = await (this.config.fetch ?? fetch)(
			`${this.config.baseUrl ?? ANTHROPIC_BASE_URL}/v1/messages`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-api-key': this.config.apiKey,
					'anthropic-version': ANTHROPIC_VERSION,
				},
				body: JSON.stringify({
					model: this.config.model,
					stream: true,
					max_tokens: opts.maxTokens ?? 1024,
					...(opts.system ? { system: opts.system } : {}),
					messages: [{ role: 'user', content: input }],
					...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
				}),
				signal: opts.signal,
			}
		)
		if (!res.ok) throw new Error(`anthropic: HTTP ${res.status}`)
		let usage: ProviderUsage | undefined
		let terminal: RunTerminalReason = 'completed'
		try {
			let event = ''
			for await (const line of sseLines(res, opts.signal)) {
				if (line.startsWith('event:')) {
					event = line.slice(6).trim()
					continue
				}
				if (!line.startsWith('data:')) continue
				const data = line.slice(5).trim()
				let parsed: AnthropicStreamEvent
				try {
					parsed = JSON.parse(data) as AnthropicStreamEvent
				} catch {
					continue
				}
				const u = toUsage(parsed)
				if (u) usage = { ...usage, ...u }
				const kind = parsed.type ?? event
				if (kind === 'content_block_delta' && parsed.delta?.text) {
					seq += 1
					trace({ runId, outputId, seq, kind: 'text.delta', usage })
					yield {
						envelope: { runId, outputId, kind: 'text.delta', seq },
						payload: { text: parsed.delta.text },
					}
				}
				if (kind === 'message_error' || kind === 'error') terminal = 'failed'
			}
		} catch (e) {
			if (opts.signal?.aborted || (e as Error).message.includes('cancelled')) terminal = 'cancelled'
			else throw e
		}
		seq += 1
		const estimatedCost = estimateCost(usage, this.pricing)
		trace({
			runId,
			outputId,
			seq,
			kind: 'terminal',
			usage,
			...(estimatedCost ? { estimatedCost } : {}),
			terminal,
		})
		yield {
			envelope: { runId, outputId, kind: 'terminal', seq },
			payload: { reason: terminal, ...(usage ? { usage } : {}) },
		}
	}
}

/** Build from server env. Throws when the key is missing. */
export function anthropicFromEnv(
	env: Record<string, string | undefined>,
	opts: Omit<AnthropicConfig, 'apiKey'> & { keyEnv?: string }
): AnthropicAdapter {
	const name = opts.keyEnv ?? 'ANTHROPIC_API_KEY'
	const key = env[name]
	if (!key) throw new Error(`anthropic: missing ${name} (server env only)`)
	const { keyEnv: _ignored, ...rest } = opts
	return new AnthropicAdapter({ ...rest, apiKey: key })
}

function assertModel(config: AnthropicConfig): void {
	if (!config.apiKey) throw new Error('anthropic: apiKey required (server env ANTHROPIC_API_KEY)')
	if (!config.model) throw new Error('anthropic: model required')
	if (config.allowlist && !config.allowlist.includes(config.model))
		throw new Error(`anthropic: model ${config.model} not in allowlist`)
}
