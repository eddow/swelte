// Phase A common skeleton: envelope shared by text, structured, tool and
// future media events. Turn is optional; a run-level event omits it.
export interface AiEnvelope {
	runId: string
	turnId?: string
	outputId: string
	kind: string
	seq: number
}

// Built-in event kinds. App code uses namespaced kinds such as `app:note/1`.
// The `media/` prefix is reserved for the @swelte/ai/media entry point.
export const AI_BUILTIN_KINDS = [
	'text.delta',
	'transcript.revision',
	'citation',
	'tool.progress',
	'approval.request',
	'state.patch',
	'state.snapshot.request',
	'control',
	'terminal',
] as const
export type AiBuiltinKind = (typeof AI_BUILTIN_KINDS)[number]

// Namespaced app kinds look like `app:note/1` — namespace, colon, name, slash
// version. Built-ins and the media prefix never match this shape.
const APP_KIND_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*\/\d+$/

export function isBuiltinKind(kind: string): kind is AiBuiltinKind {
	return (AI_BUILTIN_KINDS as readonly string[]).includes(kind)
}

export function isAppKind(kind: string): boolean {
	return APP_KIND_RE.test(kind)
}

/** Event kinds a client must understand; unknown optional kinds are skipped. */
export function isKnownKind(kind: string): boolean {
	if (isBuiltinKind(kind)) return true
	if (kind.startsWith('media/')) return false // media entry point only
	return isAppKind(kind)
}

export function validateEnvelope(env: AiEnvelope): string[] {
	const errors: string[] = []
	if (!env.runId) errors.push('runId required')
	if (!env.outputId) errors.push('outputId required')
	if (!env.kind) errors.push('kind required')
	else if (!isKnownKind(env.kind)) errors.push(`unknown event kind: ${env.kind}`)
	if (!Number.isInteger(env.seq) || env.seq < 0) errors.push('seq must be a non-negative integer')
	return errors
}

export type RunTerminalReason = 'completed' | 'cancelled' | 'failed' | 'interrupted'

export interface RunTerminal {
	reason: RunTerminalReason
	atSeq: number
}

/**
 * Track per-output completion: ending one output leaves the others active
 * until the run emits a terminal event closing the run as a whole.
 */
export class RunTracker {
	private ended = new Set<string>()
	private terminal: RunTerminal | null = null

	endOutput(outputId: string): void {
		this.ended.add(outputId)
	}

	finish(reason: RunTerminalReason, atSeq: number): void {
		this.terminal = { reason, atSeq }
	}

	get isTerminal(): boolean {
		return this.terminal !== null
	}

	get terminalState(): RunTerminal | null {
		return this.terminal
	}

	endedOutputs(): string[] {
		return [...this.ended]
	}
}
