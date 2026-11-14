module room

import backend

@[sse]
pub fn watch(req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) {
	name := req.query['name'] or { 'dogfood-room' }
	ch := sub(name)
	// Repeated subscriptions must all be removed, not overwrite one id.
	sub(name)
	if !emit('subscribed') { return }
	for { message := <-ch or { return }; if !emit(message) { return } }
}
