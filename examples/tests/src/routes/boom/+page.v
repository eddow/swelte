// Load-throw fixture: @[load] always throws -> +error 500 HTML, server stays up.
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

@[get]
pub fn boom_status(req SwelteRequest) !string {
	_ = req
	return error('boom')
}
