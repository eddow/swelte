// shell/ai frontend helper: optimistic gating + in-memory approvals.
// Consumer-side only — the authoritative backend allowlist + approval
// records live in the shell route backend (src/routes/shell/ai/+page.v);
// this mirrors them for instant UI feedback and offline tests.
export type ShellCaller = 'human' | 'ai'

export interface ShellDecision {
	allowed: boolean
	reason: string
	/** AI-proposed side-effecting commands need human approval first. */
	needsApproval: boolean
}

const ALLOWLIST = new Set(['echo', 'pwd', 'whoami', 'help'])

export function authorizeShellCall(caller: ShellCaller, cmd: string): ShellDecision {
	const name = cmd.trim().split(/\s+/)[0] ?? ''
	if (!name) return { allowed: false, reason: 'empty command', needsApproval: false }
	if (!ALLOWLIST.has(name))
		return { allowed: false, reason: `command not allowlisted: ${name}`, needsApproval: false }
	if (caller === 'ai')
		return { allowed: false, reason: 'ai shell.exec needs human approval', needsApproval: true }
	return { allowed: true, reason: 'human allowlisted command', needsApproval: false }
}

/** Stateless demo execution for the allowlist (no OS shell — demo only). */
export function runAllowlisted(cmd: string): string {
	const parts = cmd.trim().split(/\s+/)
	const name = parts[0] ?? ''
	if (!ALLOWLIST.has(name)) throw new Error(`command not allowlisted: ${name}`)
	if (name === 'echo') return parts.slice(1).join(' ')
	if (name === 'help') return 'allowlist: echo pwd whoami help'
	if (name === 'pwd') return '/shell/ai'
	if (name === 'whoami') return 'swelte-shell'
	throw new Error(`command not allowlisted: ${name}`)
}

export interface ApprovalRecord {
	opId: string
	caller: ShellCaller
	cmd: string
	decision: 'pending' | 'approved' | 'denied' | 'expired'
	expiresAt: number
	executed: boolean
}

/**
 * Persist side-effect approvals keyed by caller + exact args + operation id.
 * Duplicate op ids replay the first decision without re-executing; expired
 * approvals deny; lost-ack recovery reconciles from the executed flag.
 */
export class ApprovalStore {
	private records = new Map<string, ApprovalRecord>()

	request(caller: ShellCaller, cmd: string, opId: string, ttlMs = 300_000): ApprovalRecord {
		const existing = this.records.get(opId)
		if (existing) return existing
		const rec: ApprovalRecord = {
			opId,
			caller,
			cmd,
			decision: 'pending',
			expiresAt: Date.now() + ttlMs,
			executed: false,
		}
		this.records.set(opId, rec)
		return rec
	}

	decide(opId: string, decision: 'approved' | 'denied'): ApprovalRecord {
		const rec = this.records.get(opId)
		if (!rec) throw new Error(`unknown approval ${opId}`)
		if (rec.decision !== 'pending') return rec // duplicate: fold away, no re-execution
		if (Date.now() > rec.expiresAt) {
			rec.decision = 'expired'
			return rec
		}
		rec.decision = decision
		return rec
	}

	/** Mark executed; a second mark (lost ack retry) reports already=true. */
	markExecuted(opId: string): { record: ApprovalRecord; already: boolean } {
		const rec = this.records.get(opId)
		if (!rec) throw new Error(`unknown approval ${opId}`)
		if (rec.executed) return { record: rec, already: true }
		if (rec.decision !== 'approved') throw new Error(`approval ${opId} is ${rec.decision}`)
		rec.executed = true
		return { record: rec, already: false }
	}

	get(opId: string): ApprovalRecord | undefined {
		return this.records.get(opId)
	}
}
