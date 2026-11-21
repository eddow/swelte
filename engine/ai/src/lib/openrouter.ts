// OpenRouter adapter: first real `AiAdapter` (the ORM's first SQL dialect).
// OpenAI-compatible chat-completions over SSE, streamed as engine events.
// Key always comes from the app server env — never the browser or a bundle.

import type { AiAdapter } from './adapters.js'
import type { AdapterCaps, RunRequirements } from './capabilities.js'
import type { RunTerminalReason } from './envelope.js'
import type { WireEvent } from './sse.js'
import type { ProviderUsage, TraceEvent, TraceSink } from './trace.js'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface OpenRouterConfig {
	apiKey: string
	model: string
	allowlist?: string[]
	baseUrl?: string
	siteUrl?: string
	appTitle?: string
	latencyMs?: number
	costPerRun?: number
	onEvent?: (event: TraceEvent) => void
	sink?: TraceSink
	fetch?: typeof fetch
}

export interface OpenRouterRunOptions {
	system?: string
	maxTokens?: number
	temperature?: number
	signal?: AbortSignal
}

export interface ChatChunk {
	choices?: { delta?: { content?: string }; finish_reason?: string | null }[]
	usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export const OPENROUTER_CAPS: AdapterCaps = {
	input: { modalities: ['text'], encodings: ['utf-8'], duplex: false, stream: false },
	output: { modalities: ['text'], encodings: ['utf-8'], duplex: false, stream: true },
	structuredOutput: false,
	toolCalls: false,
	usageReporting: true,
	cancellation: true,
}

/** Model + requirements gate: runs before any network or device work. */
export function checkOpenRouterFit(
	requirements: RunRequirements,
	config: Pick<OpenRouterConfig, 'model' | 'allowlist'>
): string | null {
	if (config.allowlist && !config.allowlist.includes(config.model))
		return `openrouter: model ${config.model} not in allowlist`
	const need = [...requirements.input, ...requirements.output]
	if (need.some((m) => m !== 'text')) return 'openrouter: text-only adapter, run needs more'
	if (requirements.toolCalls) return 'openrouter: adapter does not support tool calls'
	if (requirements.structuredOutput) return 'openrouter: adapter does not support structured output'
	return null
}

function assertModel(config: OpenRouterConfig): void {
	if (!config.apiKey) throw new Error('openrouter: apiKey required (server env OPENROUTER_API_KEY)')
	if (!config.model) throw new Error('openrouter: model required')
	if (config.allowlist && !config.allowlist.includes(config.model))
		throw new Error(`openrouter: model ${config.model} not in allowlist`)
}

function toUsage(chunk: ChatChunk): ProviderUsage | undefined {
	const u = chunk.usage
	if (!u) return undefined
	return {
		...(u.prompt_tokens !== undefined ? { inputTokens: u.prompt_tokens } : {}),
		...(u.completion_tokens !== undefined ? { outputTokens: u.completion_tokens } : {}),
	}
}

async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
	const reader = res.body?.getReader()
	if (!reader) throw new Error('openrouter: empty response body')
	const decoder = new TextDecoder()
	let buf = ''
	for (;;) {
		if (signal?.aborted) {
			await reader.cancel().catch(() => {})
			throw new Error('openrouter: cancelled')
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

export class OpenRouterAdapter implements AiAdapter {
	name = 'openrouter'
	readonly model: string
	readonly latencyMs: number
	readonly costPerRun: number
	readonly caps = OPENROUTER_CAPS
	private config: OpenRouterConfig

	constructor(config: OpenRouterConfig) {
		assertModel(config)
		this.config = config
		this.model = config.model
		this.latencyMs = config.latencyMs ?? 0
		this.costPerRun = config.costPerRun ?? 0
	}

	async *run(
		input: string,
		requirements: RunRequirements,
		opts: OpenRouterRunOptions = {}
	): AsyncIterable<WireEvent> {
		const unfit = checkOpenRouterFit(requirements, this.config)
		if (unfit) throw new Error(unfit)
		const runId = `run-openrouter-${Date.now().toString(36)}`
		const outputId = 'out-text'
		const emit = this.config.onEvent ?? this.config.sink?.record.bind(this.config.sink)
		let seq = 0
		const trace = (event: TraceEvent) => emit?.(event)
		const res = await (this.config.fetch ?? fetch)(
			`${this.config.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${this.config.apiKey}`,
					...(this.config.siteUrl ? { 'HTTP-Referer': this.config.siteUrl } : {}),
					...(this.config.appTitle ? { 'X-Title': this.config.appTitle } : {}),
				},
				body: JSON.stringify({
					model: this.config.model,
					stream: true,
					stream_options: { include_usage: true },
					messages: [
						...(opts.system ? [{ role: 'system', content: opts.system }] : []),
						{ role: 'user', content: input },
					],
					...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
					...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
				}),
				signal: opts.signal,
			}
		)
		if (!res.ok) throw new Error(`openrouter: HTTP ${res.status}`)
		let usage: ProviderUsage | undefined
		let terminal: RunTerminalReason = 'completed'
		try {
			let pending: string[] = []
			const flush = function* (): Generator<WireEvent> {
				if (!pending.length) return
				const data = pending.join('\n')
				pending = []
				if (data === '[DONE]') return
				let chunk: ChatChunk
				try {
					chunk = JSON.parse(data) as ChatChunk
				} catch {
					return
				}
				const u = toUsage(chunk)
				if (u) usage = { ...usage, ...u }
				const delta = chunk.choices?.[0]?.delta?.content
				const fr = chunk.choices?.[0]?.finish_reason
				if (delta) {
					seq += 1
					trace({ runId, outputId, seq, kind: 'text.delta', usage })
					yield { envelope: { runId, outputId, kind: 'text.delta', seq }, payload: { text: delta } }
				}
				if (fr && fr !== 'stop' && fr !== 'end_turn') terminal = 'failed'
			}
			for await (const line of sseLines(res, opts.signal)) {
				if (line.startsWith('data:')) {
					pending.push(line.slice(5).trim())
					for (const e of flush()) yield e
				} else if (line === '') {
					for (const e of flush()) yield e
				}
			}
			for (const e of flush()) yield e
		} catch (e) {
			if (opts.signal?.aborted || (e as Error).message.includes('cancelled')) terminal = 'cancelled'
			else throw e
		}
		seq += 1
		trace({ runId, outputId, seq, kind: 'terminal', usage, terminal })
		yield {
			envelope: { runId, outputId, kind: 'terminal', seq },
			payload: { reason: terminal, ...(usage ? { usage } : {}) },
		}
	}
}

/** Build from server env. Throws when the key is missing. */
export function openRouterFromEnv(
	env: Record<string, string | undefined>,
	opts: Omit<OpenRouterConfig, 'apiKey'> & { keyEnv?: string }
): OpenRouterAdapter {
	const name = opts.keyEnv ?? 'OPENROUTER_API_KEY'
	const key = env[name]
	if (!key) throw new Error(`openrouter: missing ${name} (server env only)`)
	const { keyEnv: _ignored, ...rest } = opts
	return new OpenRouterAdapter({ ...rest, apiKey: key })
}
