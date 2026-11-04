// Parity fixture P0 item 2: load envelope (headers/cookies) on HTML navigation.
// Plain struct returned => wrapped in 200 default envelope; custom header +
// cookie must land on the HTML response.
module load_cookie_page

pub struct LoadCookieProps {
pub:
	greeting string
}

@[load]
pub fn load_cookie(req SwelteRequest) !SwelteLoadResult {
	_ = req
	mut out := SwelteLoadResult{
		status: 200
		headers: {'X-Load-Probe': 'cookie-item'}
		body: json.encode(LoadCookieProps{ greeting: 'envelope-cookie' })
	}
	swelte_cookie_set(mut out.cookies, 'load_probe', 'envelope')
	return out
}

@[get]
pub fn cookie_probe(req SwelteRequest) string {
	_ = req
	return 'cookie-ok'
}
