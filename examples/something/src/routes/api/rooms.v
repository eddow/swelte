// Room-mode SSE (future.md #4) + cross-request publish on the shared hub.
// `say` publishes via backend.emit; `stream` subscribes (?room=, lobby default).
// Needs dbPlugin (backend hub) — build error without it names the fix.
module rooms

import backend
import time

pub struct SayIn {
pub:
	room string
	msg  string
}

@[rpc]
pub fn say(args SayIn) int {
	return backend.emit(args.room, args.msg)
}

@[sse]
pub fn stream(req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) {
	room := req.query['room'] or { 'lobby' }
	ch := sub(room)
	for {
		select {
			m := <-ch {
				if !emit(m) {
					return
				}
			}
			30 * time.second {
				if !emit('__ping__') {
					return
				}
			}
		}
	}
}
