// `swelte_agent` — PTC agent-eval C glue between V and vendored QuickJS.
//
// Sibling of `swelte_qjs.*` (SSR render glue), same guard family, different
// contract: evaluate agent-authored JavaScript in a dedicated context with
// time/memory/call-count/result-size budgets, then return.
//
// OWNERSHIP (V 0.5.2 autofree): same rule as the render glue — NEVER return
// malloc'd pointers. The caller passes fixed V-side buffers + lengths, C
// copies the outcome in and reports the needed length. `out==0` means
// empty; negative means failure (same codes as the render contract).
//
// WIDTH (V 0.5.2 codegen): u64 C args/returns arrive truncated to 32 bits.
// Handles and sizes cross as `int`.
//
// Agent-eval contract:
//   swelte_agent_eval(handle, src, src_len, bindings_json, bindings_len,
//                       out_buf, out_cap, result_len_out,
//                       timeout_ms, mem_cap_mb, max_calls, max_result_b,
//                       diagnostic_buf, diagnostic_cap) -> 0 on success,
//                       negative on failure.
//   - fresh JSContext per call; runtime is per-eval via the opaque int
//     handle (created by swelte_qjs_new_runtime, freed by
//     swelte_qjs_free_runtime — V must NOT free it with C.free()).
//   - `src` is the agent-authored program (async JS: top-level await
//     allowed — unlike the sync-only SSR renderer). The model receives
//     signatures for the selected bindings; TypeScript declarations
//     describe those bindings.
//   - `bindings_json` is the resolved binding table the V host owns:
//     `[{"name": ..., "args_schema": ..., "side_effect": bool}, ...]`.
//     Each binding is registered as a JS function that calls back into
//     the native host dispatcher. The host resolves or rejects the
//     binding's promise and advances the QuickJS job queue.
//   - validation order (fail closed): syntax + statically known
//     references checked before starting; immediately before each native
//     call the V host validates resolved args, remaining budget and
//     caller authorization; the result is validated before returning it
//     to the program.
//   - copies the final value (JSON string) into `out_buf` (truncated to
//     `out_cap-1` + NUL); returns the FULL needed length via
//     `result_len_out`. V compares: needed <= out_cap-1 means complete,
//     else `output_limit`. `max_result_b` caps the admitted result
//     independent of buffer size — a program yielding more is rejected,
//     not truncated.
//   - returns -1 (JS exception — detail in the diagnostic buffer), -5
//     (timeout), -6 (memory exhaustion), -3 (load/compile failure,
//     including over-budget syntax), -7 (budget: too many binding calls
//     or result over `max_result_b`), -2 (unknown binding reference).
//     Any failure → V reports, never executes a partial side effect.
//   - diagnostics: same private caller-owned buffer as the render glue.
//     At most diagnostic_cap-1 bytes, NUL terminated; cleared on every
//     invocation. The caller decides whether to forward it to
//     server-only reporting. No global error slot: concurrent evals
//     cannot consume each other's diagnostics.
//
// Guards (enforced here, not in JS):
//   - interrupt handler: wall-clock budget in ms (0 = none; agent prod
//     ~1000). On fire the eval aborts → -5.
//   - memory cap in MB (0 = none; prod 16). Exhaustion returns -6.
//   - call-count cap: the host counts native binding invocations; past
//     `max_calls` the next call rejects → -7. The count survives across
//     the job-queue pumps of one eval (one program, one budget).
//   - no `fs`/`net`/`process` shims are ever registered — the agent
//     context has no I/O globals at all. Bindings are the only bridge
//     to the native side.
#ifndef SWELTE_AGENT_H
#define SWELTE_AGENT_H

#ifdef __cplusplus
extern "C" {
#endif

// Evaluate one agent program. `result_len_out` receives the FULL needed
// length (excluding NUL). Return 0 on success (check the len), negative
// on failure (-1 exception, -5 timeout, -6 memory, -3 load/compile, -7
// call/result budget, -2 unknown binding).
int swelte_agent_eval(int rt_handle, const char *src, int src_len,
                      const char *bindings_json, int bindings_len,
                      char *out_buf, int out_cap, int *result_len_out,
                      int timeout_ms, unsigned mem_cap_mb, int max_calls,
                      int max_result_b, char *diagnostic_buf,
                      int diagnostic_cap);

#ifdef __cplusplus
}
#endif

#endif
