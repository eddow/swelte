// shell frontend helper: optimistic gating + in-memory approvals + driver lease.
// Consumer-side only — the authoritative backend allowlist + approval
// records live in the dispatch table (generated `tools` module) and the
// driver lease + scrollback live in route KV (`src/routes/+page.v`);
// this mirrors them for instant UI feedback and offline tests.
export type ShellCaller = 'human' | 'ai'

export interface ShellDecision {
	allowed: boolean
	reason: string
	/** AI-proposed side-effecting commands need human approval first. */
	needsApproval: boolean
}

const ALLOWLIST = new Set(['echo', 'pwd', 'whoami', 'help', 'cat'])

/** Turn-scoped driver lease TTL seconds — must match `shell_driver_ttl_s`. */
export const DRIVER_TTL_S = 90

export type ShellDriver = { kind: 'human' } | { kind: 'ai'; holder: string; expiresAt: number }

/**
 * Parse a `shell:driver` KV value (`human` | `ai:<holder>`) with its expiry
 * into advisory frontend state. Expired or malformed leases read as human.
 */
export function parseDriver(
	driver: string,
	expiresUnix: number,
	nowS = Date.now() / 1000
): ShellDriver {
	if (!driver.startsWith('ai:') || driver.length <= 3) return { kind: 'human' }
	const holder = driver.slice(3)
	if (!holder || nowS > expiresUnix) return { kind: 'human' }
	return { kind: 'ai', holder, expiresAt: expiresUnix }
}

/** True when `holder` owns the drive right now (advisory — backend decides). */
export function driverHolds(driver: ShellDriver, holder: string): boolean {
	return driver.kind === 'ai' && driver.holder === holder && Date.now() / 1000 <= driver.expiresAt
}

export function authorizeShellCall(caller: ShellCaller, cmd: string): ShellDecision {
	const name = cmd.trim().split(/\s+/)[0] ?? ''
	if (!name) return { allowed: false, reason: 'empty command', needsApproval: false }
	if (!ALLOWLIST.has(name))
		return { allowed: false, reason: `command not allowlisted: ${name}`, needsApproval: false }
	if (caller === 'ai')
		return { allowed: false, reason: 'ai shell.exec needs human approval', needsApproval: true }
	return { allowed: true, reason: 'human allowlisted command', needsApproval: false }
}

/** Stateless demo execution for the allowlist (no OS shell — demo only).
 * `cat` has no stdin offline; the backend queues keystrokes for it. */
export function runAllowlisted(cmd: string): string {
	const parts = cmd.trim().split(/\s+/)
	const name = parts[0] ?? ''
	if (!ALLOWLIST.has(name)) throw new Error(`command not allowlisted: ${name}`)
	if (name === 'echo') return parts.slice(1).join(' ')
	if (name === 'help') return 'allowlist: echo pwd whoami help cat'
	if (name === 'pwd') return '/shell'
	if (name === 'whoami') return 'swelte-shell'
	if (name === 'cat') return '(stdin arrives over the live room)'
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
