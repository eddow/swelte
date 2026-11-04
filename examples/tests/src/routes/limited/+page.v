// Parity fixture P1 item 12: per-route limits (rate 2 / 60s window).
module limited_page

@[get]
pub fn limited_probe(req SwelteRequest) string {
	_ = req
	return 'limited-ok'
}
