// Stream demo: both list-mode + emit-mode SSE in one place.
module stream_page

@[get]
pub fn stream_hint(req SwelteRequest) string {
	_ = req
	return 'stream: emit (tick_stream) + list (tick_items)'
}
