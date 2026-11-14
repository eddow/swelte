module events

import os

@[sse]
pub fn events(req SwelteRequest, emit fn (string) bool) {
	if req.query['mode'] == 'empty' { emit(''); emit('after-empty'); return }
	if req.query['mode'] == 'flood' {
		defer { os.write_file('sse-cancelled', 'released') or {} }
		for _ in 0 .. 10000 { if !emit('x'.repeat(65536)) { return } }
		return
	}
	emit(req.locals['locale'] or { 'missing guard' })
}
