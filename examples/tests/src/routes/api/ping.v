// Minimal JSON API probe: GET /api/ping -> pong (bypasses SSR).
module ping

@[get]
pub fn ping(req SwelteRequest) string {
	_ = req
	return 'pong'
}

