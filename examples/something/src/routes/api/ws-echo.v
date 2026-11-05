// WS echo socket (future.md #3): whatever the client sends, the server
// sends back on the same socket. Needs dbPlugin (backend hub).
module ws_echo

@[ws]
pub fn ws_echo(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
	_ = req
	_ = sub
	for {
		msg := <-recv or { return }
		if !emit(msg) {
			return
		}
	}
}
