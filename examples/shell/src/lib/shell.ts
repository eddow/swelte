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

const ALLOWLIST = new Set(['echo', 'pwd', 'whoami', 'help', 'cat', 'ls', 'cd'])

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
	// Human terminal input runs the real sandboxed shell directly — no
	// "not allowlisted" error, not in the terminal, not in the chat.
	// Unsupported names return an honest message from the backend.
	if (caller === 'human') return { allowed: true, reason: 'human command runs sandboxed', needsApproval: false }
	// AI proposals always park for human approval — even outside the demo
	// allowlist. Point-blank refusal would deny the human any chance to
	// confirm; the dispatch table + tool body enforce the final gate after
	// the decision.
	if (!ALLOWLIST.has(name))
		return { allowed: false, reason: `command needs human approval: ${name}`, needsApproval: true }
	return { allowed: false, reason: 'ai shell.exec needs human approval', needsApproval: true }
}

/** Frontend mirror of the sandboxed execution (instant UI feedback +
 * offline tests). Builtins (echo/pwd/whoami/help/cat-stdin) match the
 * backend exactly; ls/cd/cat-file need the live backend — the mirror throws
 * `needs backend` for them so tests stay honest. Unsupported names throw
 * `unsupported command` — never a fake `ran:`. */
export function runAllowlisted(cmd: string): string {
	const parts = cmd.trim().split(/\s+/)
	const name = parts[0] ?? ''
	if (!ALLOWLIST.has(name)) throw new Error(`unsupported command: ${name} (try help)`)
	if (name === 'echo') return parts.slice(1).join(' ')
	if (name === 'help') return 'commands: echo pwd whoami help ls cd cat <file>  (sandboxed to the project root; bare cat reads stdin)'
	if (name === 'whoami') return 'swelte-shell'
	if (name === 'cat' && parts.length === 1) return '(stdin arrives over the live room)'
	if (name === 'pwd' || name === 'ls' || name === 'cd' || name === 'cat')
		throw new Error(`${name}: needs backend (sandboxed live execution)`)
	throw new Error(`unsupported command: ${name} (try help)`)
}

/** Result after a human decision on this exact op: builtins resolve
 * directly, backend-resolved commands are marked for live execution. */
export function runApproved(cmd: string): string {
	const parts = cmd.trim().split(/\s+/)
	const name = parts[0] ?? ''
	if (!name) throw new Error('empty command')
	if (!ALLOWLIST.has(name)) throw new Error(`unsupported command: ${name} (try help)`)
	if (name === 'pwd' || name === 'ls' || name === 'cd' || (name === 'cat' && parts.length > 1))
		return `approved for live execution: ${cmd.trim()}`
	return runAllowlisted(cmd)
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
		if (existing) {
			if (existing.caller !== caller || existing.cmd !== cmd) throw new Error(`approval ${opId} binding mismatch`)
			return existing
		}
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
		if (Date.now() > rec.expiresAt) rec.decision = 'expired'
		if (rec.decision !== 'approved') throw new Error(`approval ${opId} is ${rec.decision}`)
		rec.executed = true
		return { record: rec, already: false }
	}

	get(opId: string): ApprovalRecord | undefined {
		return this.records.get(opId)
	}
}
