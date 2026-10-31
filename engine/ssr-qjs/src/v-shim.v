// V runtime bridge stub (copied verbatim into routes/ by generate()):
// copied verbatim into routes/ by generate() — never -I node_modules.
// Per-request QuickJS runtime+context (or small pool),
// eval(render.js once) + eval(renderRoute(props)).
// Guards: ~50ms timeout → SPA fallback, ~16MB cap, no fs/net/process.
fn swelte_qjs_timeout_ms() int {
	return 50
}
