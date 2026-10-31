// Swelte admin wrapper: nav chrome (svelte) + subtree guard (V middleware).
module admin_route

// Layout data every /admin/* page merges. Leaf reads it from props
// (precedence is unidirectional: route → page, never the reverse).
pub struct AdminLayout {
pub:
	section string
	org_id  int
}

@[before]
pub fn require_session(req SwelteRequest) !SwelteRequest {
	token := req.cookies['sess'] or { return error('missing session') }
	mut r := req
	r.headers['x-user'] = token
	return r
}

// Layout data: every /admin/* page merges this under its file key.
@[load]
pub fn load_layout(req SwelteRequest) !AdminLayout {
	_ = req
	return AdminLayout{
		section: 'admin'
		org_id: 7
	}
}

@[after]
pub fn stamp_admin(req SwelteRequest, code int, body string) !(int, string) {
	return code, body
}
