// Session wrapper: stamps locals['uid'] from the sess cookie (guest fallback).
// Loads/verbs on the leaf read req.locals['uid'] — no header injection needed.
module session_route

@[before]
pub fn stamp_uid(req SwelteRequest) !SwelteRequest {
	mut r := req
	token := req.cookies['sess'] or { 'guest' }
	r.locals['uid'] = token
	return r
}
