module events

@[sse]
pub fn events(req SwelteRequest, emit fn (string) bool) {
	emit(req.locals['locale'] or { 'missing guard' })
}
