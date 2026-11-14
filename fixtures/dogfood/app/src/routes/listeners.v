module listeners

import backend

@[get]
pub fn count(req SwelteRequest) SwelteResponse {
	return SwelteResponse{body: backend.hub_listeners(req.query['name'] or { 'dogfood-room' }).str()}
}
