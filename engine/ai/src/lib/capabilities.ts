// Phase A: adapter capability advertisement split by input vs. output.
// Selected against run requirements before devices open or data flows.
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'structured' | 'sensor'

export interface DirectionCaps {
	modalities: Modality[]
	encodings: string[]
	/** e.g. live audio in vs. chunked upload. */
	duplex: boolean
	/** true when this direction arrives as a live byte stream. */
	stream?: boolean
}

export interface AdapterCaps {
	input: DirectionCaps
	output: DirectionCaps
	structuredOutput: boolean
	toolCalls: boolean
	usageReporting: boolean
	cancellation: boolean
}

export interface RunRequirements {
	input: Modality[]
	output: Modality[]
	structuredOutput?: boolean
	toolCalls?: boolean
	usageReporting?: boolean
	cancellation?: boolean
	encodings?: string[]
}

export interface AdapterSelection {
	name: string
	model: string
	caps: AdapterCaps
}

/** Select the first adapter whose input AND output sides both cover the run. */
export function selectAdapter(
	requirements: RunRequirements,
	candidates: AdapterSelection[]
): AdapterSelection | null {
	for (const c of candidates) {
		if (!requirements.input.every((m) => c.caps.input.modalities.includes(m))) continue
		if (!requirements.output.every((m) => c.caps.output.modalities.includes(m))) continue
		if (requirements.structuredOutput && !c.caps.structuredOutput) continue
		if (requirements.toolCalls && !c.caps.toolCalls) continue
		if (requirements.usageReporting && !c.caps.usageReporting) continue
		if (requirements.cancellation && !c.caps.cancellation) continue
		if (requirements.encodings?.length) {
			const have = new Set([...c.caps.input.encodings, ...c.caps.output.encodings])
			if (!requirements.encodings.every((e) => have.has(e))) continue
		}
		return c
	}
	return null
}

/** Human-actionable failure when nothing covers the run — surface pre-capture. */
export function capabilityFailure(
	requirements: RunRequirements,
	candidates: AdapterSelection[]
): string {
	const names = candidates.map((c) => c.name).join(', ') || '(no adapters)'
	const missing = (side: 'input' | 'output') =>
		requirements[side].filter((m) => !candidates.some((c) => c.caps[side].modalities.includes(m)))
	const parts: string[] = []
	for (const side of ['input', 'output'] as const) {
		const gap = missing(side)
		if (gap.length) parts.push(`${side} lacks: ${gap.join(', ')}`)
	}
	if (requirements.toolCalls && !candidates.some((c) => c.caps.toolCalls))
		parts.push('no adapter supports tool calls')
	if (requirements.structuredOutput && !candidates.some((c) => c.caps.structuredOutput))
		parts.push('no adapter supports structured output')
	return `no adapter covers this run [${names}]${parts.length ? `: ${parts.join('; ')}` : ''}`
}
