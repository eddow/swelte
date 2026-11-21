// AI configurations for the shell chat pane.
//
// A configuration = adapter + model + run config (temperature, max tokens,
// system prompt). Several configurations can exist; the chat window lets the
// user pick the active one. Configurations are client-side only and persist
// in localStorage — they never carry API keys. Servers read keys from
// process env (populated from `.env`, see `loadDotenv` in toolchain).
export type AiAdapterKind = 'deterministic' | 'openrouter' | 'openai' | 'anthropic'

export interface AiRunConfig {
	/** Sampling temperature. Omitted = provider default. */
	temperature?: number
	/** Max output tokens. Omitted = provider default (anthropic: 1024 server-side). */
	maxTokens?: number
	/** System prompt prepended to the run. Omitted = none. */
	system?: string
}

export interface AiConfiguration {
	id: string
	name: string
	adapter: AiAdapterKind
	model: string
	run: AiRunConfig
}

export const AI_CONFIG_KEY = 'swelte-shell-ai-configs-v1'
export const AI_ACTIVE_CONFIG_KEY = 'swelte-shell-ai-active-v1'

/** Adapter kinds with server-side API keys (env-only, never localStorage). */
export const KEYED_ADAPTERS: AiAdapterKind[] = ['openrouter', 'openai', 'anthropic']

/** Suggested models per adapter (offline fallback — the live catalog from
 *  `ai_models` wins when reachable). */
export const ADAPTER_MODELS: Record<AiAdapterKind, string[]> = {
	deterministic: ['deterministic-1'],
	openrouter: [
		'openai/gpt-4o-mini',
		'openai/gpt-4o',
		'anthropic/claude-3-5-haiku',
		'anthropic/claude-sonnet-4',
		'google/gemini-2.0-flash-001',
		'meta-llama/llama-3.3-70b-instruct',
	],
	openai: ['gpt-4o-mini', 'gpt-4o', 'o4-mini', 'gpt-4.1-mini'],
	anthropic: ['claude-3-5-haiku-latest', 'claude-sonnet-4-20250514', 'claude-opus-4-1-20250805'],
}

/** Default configurations: offline echo + one slot per implemented adapter. */
export function defaultAiConfigs(): AiConfiguration[] {
	return [
		{
			id: 'local-echo',
			name: 'Local echo (offline)',
			adapter: 'deterministic',
			model: 'deterministic-1',
			run: {},
		},
		{
			id: 'openrouter-default',
			name: 'OpenRouter',
			adapter: 'openrouter',
			model: 'openai/gpt-4o-mini',
			run: {},
		},
		{ id: 'openai-default', name: 'OpenAI', adapter: 'openai', model: 'gpt-4o-mini', run: {} },
		{
			id: 'anthropic-default',
			name: 'Anthropic',
			adapter: 'anthropic',
			model: 'claude-3-5-haiku-latest',
			run: {},
		},
	]
}

function safeId(): string {
	try {
		return crypto.randomUUID()
	} catch {
		return `ai-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`
	}
}

function cleanRun(run: AiRunConfig): AiRunConfig {
	const out: AiRunConfig = {}
	if (typeof run.temperature === 'number' && Number.isFinite(run.temperature))
		out.temperature = run.temperature
	if (typeof run.maxTokens === 'number' && Number.isFinite(run.maxTokens) && run.maxTokens > 0)
		out.maxTokens = Math.floor(run.maxTokens)
	if (typeof run.system === 'string' && run.system.trim() !== '') out.system = run.system
	return out
}

function cleanConfig(raw: unknown): AiConfiguration | null {
	if (typeof raw !== 'object' || raw === null) return null
	const c = raw as Record<string, unknown>
	const adapter = c.adapter
	if (
		adapter !== 'deterministic' &&
		adapter !== 'openrouter' &&
		adapter !== 'openai' &&
		adapter !== 'anthropic'
	)
		return null
	const model = typeof c.model === 'string' ? c.model.trim() : ''
	if (!model) return null
	const run = typeof c.run === 'object' && c.run !== null ? (c.run as AiRunConfig) : {}
	return {
		id: typeof c.id === 'string' && c.id ? c.id : safeId(),
		name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : `${adapter} / ${model}`,
		adapter,
		model,
		run: cleanRun(run),
	}
}

/** Load persisted configurations; falls back to defaults (private mode safe). */
export function loadAiConfigs(): AiConfiguration[] {
	try {
		const raw = localStorage.getItem(AI_CONFIG_KEY)
		if (!raw) return defaultAiConfigs()
		const parsed = JSON.parse(raw) as unknown
		if (!Array.isArray(parsed)) return defaultAiConfigs()
		const cleaned = parsed.map(clean).filter((c): c is AiConfiguration => c !== null)
		return cleaned.length ? cleaned : defaultAiConfigs()
	} catch {
		return defaultAiConfigs()
	}

	function clean(v: unknown): AiConfiguration | null {
		return cleanConfig(v)
	}
}

/** Persist configurations (best-effort; blocked storage is not fatal). */
export function saveAiConfigs(configs: AiConfiguration[]): void {
	try {
		localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(configs))
	} catch {
		// private mode — configs just won't persist
	}
}

/** Load the active configuration id (null = first config). */
export function loadActiveAiConfigId(): string | null {
	try {
		return localStorage.getItem(AI_ACTIVE_CONFIG_KEY)
	} catch {
		return null
	}
}

/** Persist the active configuration id (best-effort). */
export function saveActiveAiConfigId(id: string): void {
	try {
		localStorage.setItem(AI_ACTIVE_CONFIG_KEY, id)
	} catch {
		// private mode — selection just won't persist
	}
}

/** Resolve the active configuration from the list + stored id. */
export function activeAiConfig(
	configs: AiConfiguration[],
	activeId: string | null
): AiConfiguration {
	return configs.find((c) => c.id === activeId) ?? configs[0] ?? defaultAiConfigs()[0]!
}

/** Create a new configuration with a fresh id. */
export function createAiConfig(
	input: Omit<AiConfiguration, 'id'> & { id?: string }
): AiConfiguration {
	const cleaned = cleanConfig({ ...input, id: input.id ?? safeId() })
	if (!cleaned) throw new Error('invalid AI configuration (adapter + model required)')
	return cleaned
}

/** Validate + normalize an edited configuration (throws on invalid). */
export function updateAiConfig(
	existing: AiConfiguration,
	patch: Partial<Omit<AiConfiguration, 'id'>>
): AiConfiguration {
	const cleaned = cleanConfig({ ...existing, ...patch, id: existing.id })
	if (!cleaned) throw new Error('invalid AI configuration (adapter + model required)')
	return cleaned
}
