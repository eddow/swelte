// Phase A: trace sink shape defined alongside the protocol. Estimated cost
// stays distinguishable from provider-reported usage — never merged.
import type { RunTerminalReason } from './envelope.js'
import type { SchemaIdentity } from './schema.js'

/** Currency is a free-form ISO code (`USD`, `EUR`, …) — never assumed. */
export interface CostEstimate {
	currency: string
	amount: number
	/** Where the number came from: verbatim provider charge vs. local table math. */
	basis: 'provider-reported' | 'table-estimate'
}

/**
 * Abstract per-token price table (optional, per 1k tokens). No table means
 * cost is unknown — never zero. Unknown-cost adapters are excluded from
 * budget routing rather than treated as free.
 */
export interface PriceTable {
	currency: string
	inputPer1k: number
	outputPer1k: number
	/** e.g. `openrouter 2026-11 list price`, `contract-2026-Q4`. */
	source?: string
}

export interface ProviderUsage {
	inputTokens?: number
	outputTokens?: number
	/** Verbatim provider-reported charge, when the wire carries one. */
	cost?: CostEstimate
}

export interface TraceEvent {
	runId: string
	turnId?: string
	trackId?: string
	outputId: string
	seq: number
	kind: string
	schema?: SchemaIdentity | string
	tool?: { name: string; decision: 'allowed' | 'denied' | 'executed' }
	cancellation?: { requested: boolean; upstreamStopped?: boolean }
	usage?: ProviderUsage
	estimatedCost?: CostEstimate
	terminal?: RunTerminalReason
}

/** Minimal sink contract; SQLite recorder (Phase B) implements this. */
export interface TraceSink {
	record(event: TraceEvent): void
}

/**
 * Local cost math from a price table + observed usage. Returns undefined
 * when there is nothing to multiply (no table, or no token counts) — the
 * caller keeps `estimatedCost` absent rather than inventing a zero.
 */
export function estimateCost(
	usage: Pick<ProviderUsage, 'inputTokens' | 'outputTokens'> | undefined,
	pricing: PriceTable | undefined
): CostEstimate | undefined {
	if (!pricing) return undefined
	const { inputTokens = 0, outputTokens = 0 } = usage ?? {}
	if (inputTokens === 0 && outputTokens === 0) return undefined
	return {
		currency: pricing.currency,
		amount: (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k,
		basis: 'table-estimate',
	}
}

export function createMemorySink(): TraceSink & { events: TraceEvent[] } {
	const events: TraceEvent[] = []
	return { events, record: (e) => events.push(e) }
}
