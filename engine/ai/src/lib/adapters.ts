// Phase B: adapter interface + deterministic adapter. Real adapters (Phase B
// remainder) implement `AiAdapter` with different capability sets; routing
// stays in `selectAdapter` (capabilities.ts) by capability, latency, budget.
import type { AdapterSelection, Modality, RunRequirements } from './capabilities.js'
import { selectAdapter } from './capabilities.js'
import type { WireEvent } from './sse.js'

export interface AiAdapter extends AdapterSelection {
	latencyMs: number
	costPerRun: number
	run(input: string, requirements: RunRequirements): AsyncIterable<WireEvent>
}

export interface RouteOptions {
	/** Maximum acceptable latency; adapters above it are skipped. */
	maxLatencyMs?: number
	/** Maximum acceptable cost; adapters above it are skipped. */
	maxCostPerRun?: number
}

/** Capability-first routing with latency/budget filters, stable by latency. */
export function routeAdapter(
	requirements: RunRequirements,
	candidates: AiAdapter[],
	options: RouteOptions = {}
): AiAdapter | null {
	const affordable = candidates
		.filter((c) => options.maxLatencyMs === undefined || c.latencyMs <= options.maxLatencyMs)
		.filter((c) => options.maxCostPerRun === undefined || c.costPerRun <= options.maxCostPerRun)
		.sort((a, b) => a.latencyMs - b.latencyMs || a.name.localeCompare(b.name))
	return selectAdapter(requirements, affordable) as AiAdapter | null
}

/** Deterministic adapter for tests, fixtures and offline eval. */
export class DeterministicAdapter implements AiAdapter {
	name = 'deterministic'
	model = 'deterministic-1'
	latencyMs = 0
	costPerRun = 0
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
