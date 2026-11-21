// Phase B: adapter interface + cost-aware routing. Real adapters (Phase B
// remainder) implement `AiAdapter` with different capability sets; routing
// stays in `selectAdapter` (capabilities.ts) by capability, latency, budget.
import type { AdapterSelection, Modality, RunRequirements } from './capabilities.js'
import { selectAdapter } from './capabilities.js'
import type { WireEvent } from './sse.js'
import type { PriceTable } from './trace.js'

/**
 * Budget ceiling over the *estimate* domain: per-1k token prices optional
 * per adapter, so a flat per-run number would be a half-product. An adapter
 * carrying a `pricing` table exposes `estimatedCostPer1k` bounds for routing;
 * no table means unknown cost — excluded from a budgeted route, never
 * treated as free.
 */
export interface CostModel {
	pricing?: PriceTable
	/** Pre-run ceiling for routing: worst-case 1k-token blend of the table. */
	maxCostPer1k?: number
}

export interface AiAdapter extends AdapterSelection, CostModel {
	latencyMs: number
	run(input: string, requirements: RunRequirements): AsyncIterable<WireEvent>
}

export interface RouteOptions {
	/** Maximum acceptable latency; adapters above it are skipped. */
	maxLatencyMs?: number
	/**
	 * Maximum acceptable cost per 1k tokens; adapters without a price table
	 * are skipped (unknown ≠ free).
	 */
	maxCostPer1k?: number
}

/** Capability-first routing with latency/budget filters, stable by latency. */
export function routeAdapter(
	requirements: RunRequirements,
	candidates: AiAdapter[],
	options: RouteOptions = {}
): AiAdapter | null {
	const affordable = candidates
		.filter((c) => options.maxLatencyMs === undefined || c.latencyMs <= options.maxLatencyMs)
		.filter(
			(c) =>
				options.maxCostPer1k === undefined ||
				(c.maxCostPer1k !== undefined && c.maxCostPer1k <= options.maxCostPer1k)
		)
		.sort((a, b) => a.latencyMs - b.latencyMs || a.name.localeCompare(b.name))
	return selectAdapter(requirements, affordable) as AiAdapter | null
}

/** Deterministic adapter for tests, fixtures and offline eval. */
export class DeterministicAdapter implements AiAdapter {
	name = 'deterministic'
	model = 'deterministic-1'
	latencyMs = 0
	// No pricing: offline echo is free-but-unpriced, so budget routing skips
	// it (unknown ≠ free). Pass an explicit `pricing` table when a fixture
	// needs to participate in a budgeted route.
	pricing: PriceTable | undefined = undefined
	maxCostPer1k: number | undefined = undefined
	caps = {
		input: { modalities: ['text'] as Modality[], encodings: ['utf-8'], duplex: true },
		output: {
			modalities: ['text', 'structured'] as Modality[],
			encodings: ['utf-8'],
			duplex: true,
		},
		structuredOutput: true,
		toolCalls: false,
		usageReporting: true,
		cancellation: true,
	}

	async *run(input: string, requirements: RunRequirements): AsyncIterable<WireEvent> {
		const runId = 'run-deterministic'
		const outputId = 'out-text'
		yield {
			envelope: { runId, outputId, kind: 'text.delta', seq: 0 },
			payload: { text: `echo: ${input}` },
		}
		if (requirements.structuredOutput) {
			yield {
				envelope: { runId, outputId: 'out-card', kind: 'state.patch', seq: 1 },
				payload: { ops: [{ op: 'set', path: ['echo'], value: input }] },
			}
		}
		yield {
			envelope: { runId, outputId, kind: 'terminal', seq: 2 },
			payload: { reason: 'completed' },
		}
	}
}
