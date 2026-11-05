// Chat rooms: cross-request broadcast over the shared hub.
// Room SSE `stream` subscribes; `say` rpc publishes. WS pair lives in
// api/ws-echo.v + api/ws-rooms.v (same hub, socket transport).
module chat_page

@[get]
pub fn chat_hint(req SwelteRequest) string {
	_ = req
	return 'chat: use stream/say + ws sockets'
}
