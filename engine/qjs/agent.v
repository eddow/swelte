// PTC agent half of the shared `qjs` module (Phase C, step 1: stub).
//
// `agent_eval` evaluates agent-authored JavaScript in a dedicated
// QuickJS context with time/memory/call-count/result-size budgets.
// Until the `swelte_agent.{c,h}` entry lands (step 2), every call fails
// actionably so provider-only and named-call paths stay QJS-free while
// the programmatic path names its missing piece.
module qjs

// Budget set for one agent program. Mirrors the spec: wall-clock time,
// memory cap, max native binding calls, max result bytes.
pub struct AgentBudgets {
pub:
	timeout_ms   int = 1000
	mem_cap_mb   u32 = 16
	max_calls    int = 10
	max_result_b int = 65536
}

// Outcome of one `agent_eval` call. `ok=false` carries the failure
// reason; late/duplicate deliveries are rejected by the caller, never
// re-executed here.
pub struct AgentResult {
pub:
	ok     bool
	result string
	reason string
}

// Programmatic agent evaluation (stub: actionable error until the C
// entry lands). Named tool calls never touch this path — they dispatch
// through `swelte_tool_dispatch` with no JS runtime involved.
pub fn agent_eval(source string, _bindings_json string, _budgets AgentBudgets) AgentResult {
	_ = source
	return AgentResult{
		ok:     false
		reason: 'agent JS needs the qjs agent runtime (not yet implemented — named tool calls are unaffected)'
	}
}
