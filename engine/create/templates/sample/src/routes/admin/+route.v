// Swelte admin wrapper: nav chrome (svelte) + subtree guard (V middleware).
module admin_route

@[before]
pub fn require_session(req SwelteRequest) !SwelteRequest {
	token := req.cookies['sess'] or { return error('missing session') }
	mut r := req
	r.headers['x-user'] = token
	return r
}

@[after]
pub fn stamp_admin(req SwelteRequest, res SwelteResponse) !SwelteResponse {
	return res
}
