// Phase B: recording policy. Metadata by default; prompts, transcripts,
// tool payloads and media each opt in independently. Redaction runs before
// persistence; referenced assets carry explicit expiry.
export interface RecorderPolicy {
	prompts: boolean
	transcripts: boolean
	toolPayloads: boolean
	media: boolean
}

export const METADATA_ONLY: RecorderPolicy = {
	prompts: false,
	transcripts: false,
	toolPayloads: false,
	media: false,
}

export interface StoredRecord {
	/** Milliseconds after which a referenced asset must be dropped. */
	expiresAt?: number
	prompts?: unknown
	transcripts?: unknown
	toolPayloads?: unknown
	media?: unknown
}

export function redactForPolicy<T>(value: T, redact: (v: T) => T): T {
	return redact(value)
}

/** Strip a stored record down to what the policy allows. */
export function applyPolicy(record: StoredRecord, policy: RecorderPolicy): StoredRecord {
	return {
		...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
		...(policy.prompts ? { prompts: record.prompts } : {}),
		...(policy.transcripts ? { transcripts: record.transcripts } : {}),
		...(policy.toolPayloads ? { toolPayloads: record.toolPayloads } : {}),
		...(policy.media ? { media: record.media } : {}),
	}
}
