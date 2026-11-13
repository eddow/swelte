module socket

@[ws]
pub fn socket(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
	emit(req.locals['locale'] or { 'missing guard' })
}
