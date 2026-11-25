// PTC agent half of the shared `qjs` module.
//
// `agent_eval` evaluates agent-authored JavaScript in a dedicated
// QuickJS context with time/memory/call-count/result-size budgets.
// Each binding registered from `bindings_json` calls back into the V
// host dispatcher; the host validates resolved args, remaining budget
// and caller authorization before running the native tool, and the
// result is validated before returning it to the program.
//
// Named tool calls never touch this path — they dispatch through
// `swelte_tool_dispatch` with no JS runtime involved.
module agent_eval

#include "swelte_qjs.h"
#include "swelte_agent.h"

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

fn C.swelte_qjs_new_runtime() int
fn C.swelte_qjs_free_runtime(int)
fn C.swelte_agent_eval(int, &char, int, &char, int, &char, int, &int, int, u32, int, int, &char, int) int

fn agent_failure_reason(code int) string {
	return match code {
		-5 { 'timeout' }
		-6 { 'memory-limit' }
		-3 { 'compile-or-load' }
		-2 { 'unknown-binding' }
		-7 { 'budget-exhausted' }
		else { 'exception' }
	}
}

// Evaluate one agent program against the selected bindings. Fresh runtime
// per call (per-request handle, freed before return); syntax + statically
// known references fail before the first binding can run; the C entry
// pumps the job queue until the program settles; results over
// `max_result_b` are rejected, never truncated.
pub fn agent_eval(source string, bindings_json string, budgets AgentBudgets) AgentResult {
	if source.len == 0 || source.len > 1024 * 1024 {
		return AgentResult{ ok: false, reason: 'compile-or-load' }
	}
	mut rt := C.swelte_qjs_new_runtime()
	if rt == 0 {
		return AgentResult{ ok: false, reason: 'runtime-unavailable' }
	}
	defer {
		C.swelte_qjs_free_runtime(rt)
	}
	mut out := []u8{len: 65536}
	mut detail := []u8{len: 8192}
	mut need := 0
	mut rc := 0
	bindings := if bindings_json == '' { '[]' } else { bindings_json }
	unsafe {
		rc = C.swelte_agent_eval(rt, &char(source.str), source.len, &char(bindings.str),
			bindings.len, &char(&out[0]), out.len, &need, budgets.timeout_ms, budgets.mem_cap_mb,
			budgets.max_calls, budgets.max_result_b, &char(&detail[0]), detail.len)
	}
	if rc == -7 && need > 0 && need <= 1048575 {
		// Result needs a bigger caller buffer but fits the admission cap:
		// retry once with the exact size, then validate again.
		mut big := []u8{len: need + 1}
		need = 0
		unsafe {
			rc = C.swelte_agent_eval(rt, &char(source.str), source.len, &char(bindings.str),
				bindings.len, &char(&big[0]), big.len, &need, budgets.timeout_ms, budgets.mem_cap_mb,
				budgets.max_calls, budgets.max_result_b, &char(&detail[0]), detail.len)
		}
		if rc == 0 {
			out = big.clone()
		} else {
			return AgentResult{ ok: false, reason: agent_failure_reason(rc) }
		}
	}
	if rc != 0 {
		return AgentResult{ ok: false, reason: agent_failure_reason(rc) }
	}
	if need <= 0 || need >= out.len {
		return AgentResult{ ok: false, reason: 'budget-exhausted' }
	}
	result := unsafe { (&char(&out[0])).vstring_with_len(need) }.clone()
	return AgentResult{ ok: true, result: result }
}

