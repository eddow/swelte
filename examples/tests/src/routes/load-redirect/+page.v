// Parity fixture P0 item 2: load-side redirect (3xx + Location envelope).
module load_redirect_page

pub struct LoadRedirectProps {
pub:
	dummy string
}

@[load]
pub fn load_redirect(req SwelteRequest) !SwelteLoadResult {
	_ = req
	return SwelteLoadResult{
		status: 303
		headers: {'Location': '/'}
		body: json.encode(LoadRedirectProps{ dummy: 'redirect' })
	}
}

@[get]
pub fn redirect_probe(req SwelteRequest) string {
	_ = req
	return 'redirect-ok'
}
