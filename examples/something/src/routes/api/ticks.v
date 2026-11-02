// Item 5 proof, list mode on a separate file (per-file mode:
// mixed emit+list in one file is unservable, one mode per file).
// tick_items returns a string list: harness streams each
// element per-event; client consumes an identical for-await shape.
// Emit mode stays in api/greet.v (tick_stream).
module ticks

@[sse]
pub fn tick_items(req SwelteRequest) []string {
	_ = req
	return ['a', 'b', 'c']
}
