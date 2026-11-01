// Swelte load-throw fixture (SSR `!T` → 500 HTML gate).
// `@[load]` always throws: Hand maps it to +error props with status 500,
// the renderer serves +error HTML, the server stays up.
module boom_page

pub struct BoomProps {
pub:
	dummy string
}

@[load]
pub fn load_boom(req SwelteRequest) !BoomProps {
	_ = req
	return error('boom')
}

// API arm so HTML navigations reach the status>=400 +error branch:
// dispatch throws (!T → 400 JSON) → Hand renders +error 400 HTML,
// server stays up. (Timeout → 500 shares the same branch.)
@[get]
pub fn boom_status(req SwelteRequest) !string {
	_ = req
	return error('boom')
}
