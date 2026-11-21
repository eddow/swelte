// Phase A: trace sink shape defined alongside the protocol. Estimated cost
// stays distinguishable from provider-reported usage — never merged.
import type { RunTerminalReason } from './envelope.js'
import type { SchemaIdentity } from './schema.js'

export interface CostEstimate {
	currency: string
	amount: number
}

export interface ProviderUsage {
	inputTokens?: number
	outputTokens?: number
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

export function createMemorySink(): TraceSink & { events: TraceEvent[] } {
	const events: TraceEvent[] = []
	return { events, record: (e) => events.push(e) }
}
