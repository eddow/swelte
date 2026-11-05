// WS rooms socket (future.md #3): joins ?room= (default lobby) on the
// shared hub; hub messages stream out via emit. Client frames are
// consumed (but ignored) so the socket drains — use ws-echo for
// round-trip proof, this file for broadcast fan-out.
module ws_rooms

import backend
import time

pub struct WsSayIn {
pub:
	room string
	msg  string
}

@[rpc]
pub fn ws_say(args WsSayIn) int {
	return backend.emit(args.room, args.msg)
}

@[ws]
pub fn ws_rooms(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
	room := req.query['room'] or { 'lobby' }
	ch := sub(room)
	for {
		select {
			m := <-ch {
				if !emit(m) {
					return
				}
			}
			n := <-recv {
				_ = n
			}
			30 * time.second {
				if !emit('__ping__') {
					return
				}
			}
		}
	}
}
