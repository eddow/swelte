// Phase B: progressive draft state for text/structured UI. Typed patches
// apply against an expected revision; a gap requests a snapshot before
// further patches. A completed value publishes only after full validation.
// One bounded repair may replace an invalid provider response — it must
// never repeat an already executed tool.
export type PatchOp =
	| { op: 'set'; path: string[]; value: unknown }
	| { op: 'append'; path: string[]; value: string }

export interface TypedPatch {
	/** Revision this patch applies to; snapshot bumps it. */
	expectedRevision: number
	ops: PatchOp[]
}

export interface DraftSnapshot<T> {
	revision: number
	value: T
}

export class DraftStore<T extends Record<string, unknown>> {
	private revision = 0
	private value: T
	private snapshotRequested = false
	private executedTools = new Set<string>()
	private repaired = false

	constructor(initial: T) {
		this.value = structuredClone(initial)
	}

	get current(): { revision: number; value: T } {
		return { revision: this.revision, value: structuredClone(this.value) }
	}

	get needsSnapshot(): boolean {
		return this.snapshotRequested
	}

	markToolExecuted(toolCallId: string): void {
		this.executedTools.add(toolCallId)
	}

	/**
	 * Apply a patch. Returns false and flags a snapshot request on a
	 * revision gap — call `applySnapshot()` before further patches.
	 */
	applyPatch(patch: TypedPatch): boolean {
		if (patch.expectedRevision !== this.revision) {
			this.snapshotRequested = true
			return false
		}
		for (const op of patch.ops) applyOp(this.value, op)
		this.revision += 1
		return true
	}

	applySnapshot(snapshot: DraftSnapshot<T>): void {
		this.value = structuredClone(snapshot.value)
		this.revision = snapshot.revision
		this.snapshotRequested = false
	}

	/**
	 * Bounded repair: one replacement of an invalid provider value. Throws
	 * when asked to repeat an already executed tool.
	 */
	repair(replacement: T, repeatsTool?: string): T {
		if (repeatsTool && this.executedTools.has(repeatsTool))
			throw new Error(`repair must not repeat executed tool ${repeatsTool}`)
		if (this.repaired) throw new Error('repair already used: only one bounded repair per draft')
		this.repaired = true
		this.value = structuredClone(replacement)
		this.revision += 1
		return structuredClone(this.value)
	}
}

function applyOp(root: Record<string, unknown>, op: PatchOp): void {
	if (op.path.length === 0) throw new Error('patch op needs a non-empty path')
	let node: Record<string, unknown> = root
	for (const key of op.path.slice(0, -1)) {
		const next = node[key]
		if (typeof next !== 'object' || next === null)
			throw new Error(`patch path missing: ${op.path.join('.')}`)
		node = next as Record<string, unknown>
	}
	const last = op.path[op.path.length - 1]
	if (op.op === 'set') node[last] = op.value
	else {
		const cur = node[last]
		if (typeof cur !== 'string') throw new Error(`append target not a string: ${op.path.join('.')}`)
		node[last] = cur + op.value
	}
}
