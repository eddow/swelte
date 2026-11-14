module socket

@[ws]
pub fn socket(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
	if req.query['mode'] == 'room' {
		ch := sub(req.query['name'] or { 'dogfood-socket' })
		for { message := <-ch or { return }; if !emit(message) { return } }
	}
	emit(req.locals['locale'] or { 'missing guard' })
}
