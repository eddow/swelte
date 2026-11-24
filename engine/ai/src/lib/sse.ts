// Phase B: SSE framing for a streaming POST response. Text deltas,
// transcript revisions, citations, tool progress, approval requests and
// structured patches share one response; each SSE message carries one
// envelope + payload pair. App-owned framing per openspec/specs/streaming/reference.md — the
// transport moves bytes, this module owns the event shape.
import type { AiEnvelope } from './envelope.js'

export interface WireEvent {
	envelope: AiEnvelope
	payload: unknown
}

/** Encode one envelope + payload pair as a single SSE message. */
export function encodeSseEvent(envelope: AiEnvelope, payload: unknown): string {
	return `event: ${envelope.kind}\ndata: ${JSON.stringify({ envelope, payload })}\n\n`
}

/** Decode one SSE message body into envelope + payload. Throws on bad shape. */
export function decodeSseEvent(event: string, data: string): WireEvent {
	let parsed: unknown
	try {
		parsed = JSON.parse(data)
	} catch {
		throw new Error(`bad SSE data for event ${event}: not JSON`)
	}
	if (typeof parsed !== 'object' || parsed === null)
		throw new Error(`bad SSE data for event ${event}: not an object`)
	const { envelope, payload } = parsed as { envelope?: unknown; payload?: unknown }
	if (typeof envelope !== 'object' || envelope === null)
		throw new Error(`bad SSE data for event ${event}: missing envelope`)
	const env = envelope as Record<string, unknown>
	if (
		typeof env.runId !== 'string' ||
		typeof env.outputId !== 'string' ||
		typeof env.kind !== 'string'
	)
		throw new Error(`bad SSE data for event ${event}: envelope missing runId/outputId/kind`)
	if (typeof env.seq !== 'number' || !Number.isInteger(env.seq) || env.seq < 0)
		throw new Error(`bad SSE data for event ${event}: bad seq`)
	return { envelope: env as unknown as AiEnvelope, payload }
}

/** Incremental SSE parser: feed text chunks, receive complete events. */
export function createSseParser(onEvent: (event: WireEvent) => void): (chunk: string) => void {
	let buf = ''
	return (chunk: string) => {
		buf += chunk
		let idx: number
		while ((idx = buf.indexOf('\n\n')) >= 0) {
			const block = buf.slice(0, idx)
			buf = buf.slice(idx + 2)
			let event: string | null = null
			const dataLines: string[] = []
			for (const line of block.split('\n')) {
				if (line.startsWith('event:')) event = line.slice(6).trim()
				else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
			}
			if (event === null) continue
			onEvent(decodeSseEvent(event, dataLines.join('\n')))
		}
	}
}
