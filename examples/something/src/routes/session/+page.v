// Session leaf: locals + cookie constructors + redirect.
// `session/+route.v` stamps locals['uid']; loads/verbs read it.
// `?go` (POST) returns swelte_redirect('/router'); `?bye` deletes the cookie.
// NOTE: the redirect arm is POST-only by design — a GET navigation
// (`<a href="/session?go">`) has no verb arm to hit and falls through to
// the dispatch "not found" path, so the page uses a plain POST form.
module session_page

pub struct SessionProps {
pub:
	user string
	via  string
}

@[load]
pub fn load_session(req SwelteRequest) !SessionProps {
	return SessionProps{
		user: req.locals['uid'] or { 'guest' }
		via: 'locals'
	}
}

@[get]
pub fn who_session(req SwelteRequest) string {
	return 'session:' + (req.locals['uid'] or { 'guest' })
}

@[get('go')]
pub fn go_router_redirect_hint(req SwelteRequest) string {
	_ = req
	return 'use POST /session?go (GET has no verb arm)'
}

@[post('go')]
pub fn go_router(req SwelteRequest) SwelteResponse {
	_ = req
	return swelte_redirect('/router', 0)
}

@[post('logout')]
pub fn logout_session(req SwelteRequest) SwelteResponse {
	_ = req
	mut out := SwelteResponse{ status: 200, headers: {'Content-Type': 'application/json'}, body: '{"ok":true}' }
	swelte_cookie_delete(mut out.cookies, 'sess')
	return out
}

@[post]
pub fn login_session(req SwelteRequest) SwelteResponse {
	name := req.form['payload'] or { req.query['payload'] or { 'guest' } }
	mut out := SwelteResponse{ status: 200, headers: {'Content-Type': 'application/json'}, body: '{"ok":true,"user":"' + name + '"}' }
	swelte_cookie_set(mut out.cookies, 'sess', name)
	return out
}
