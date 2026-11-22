// Shared embedded-QuickJS V module (`module qjs`).
//
// Staged into `.swelte/qjs/` by whichever consumer needs it (SSR adapter,
// PTC agent plugin) — same source dir, same bytes, compiled once by V no
// matter how many bridges `import qjs`. Per-consumer wrappers stay thin:
// SSR's `routes/swelte_qjs_bridge.v` owns `render_page`; the agent bridge
// owns `agent_eval`. This file owns only what both need: budgets, failure
// taxonomy, buffer discipline.
//
// OWNERSHIP (V 0.5.2 autofree): C glue never returns malloc'd pointers —
// the caller passes heap buffers; C copies output in and reports the
// needed length. Keep every cross-boundary buffer a `[]u8` heap alloc,
// never a fixed stack array (1MB of stack overflows constrained threads);
// `&buf[0]` requires the V 0.5.x unsafe block.
module qjs

// Default evaluation budgets (consumer bridges bake their own via bridge
// constants; these are the documented fallbacks).
pub const default_timeout_ms = 50
pub const default_mem_cap_mb = u32(16)

// Failure taxonomy shared by both C contracts (render + agent eval).
// Keep in sync with `swelte_qjs_reason` / agent reason mapping.
pub enum QjsFailure {
	compile_or_load
	missing_export
	timeout
	memory_limit
	runtime_unavailable
	output_limit
	exception
}

pub fn qjs_failure_reason(code int) QjsFailure {
	return match code {
		-5 { .timeout }
		-6 { .memory_limit }
		-3 { .compile_or_load }
		-2 { .missing_export }
		else { .exception }
	}
}

pub fn (f QjsFailure) str() string {
	return match f {
		.compile_or_load { 'compile-or-load' }
		.missing_export { 'missing-export' }
		.timeout { 'timeout' }
		.memory_limit { 'memory-limit' }
		.runtime_unavailable { 'runtime-unavailable' }
		.output_limit { 'output-limit' }
		.exception { 'exception' }
	}
}

// Per-call heap buffers with grow-once discipline: `small` first, `big`
// on truncation. Mirrors the bridge template (64KB→1MB body, 8KB→64KB
// head); consumers size their own via these helpers.
pub fn qjs_small_body_buf() []u8 {
	return []u8{len: 65536}
}

pub fn qjs_big_body_buf() []u8 {
	return []u8{len: 1048576}
}

pub fn qjs_small_head_buf() []u8 {
	return []u8{len: 8192}
}

pub fn qjs_big_head_buf() []u8 {
	return []u8{len: 65536}
}

pub fn qjs_body_limit() int {
	return 1048575
}

pub fn qjs_head_limit() int {
	return 65535
}
