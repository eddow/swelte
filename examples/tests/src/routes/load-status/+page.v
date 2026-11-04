// Parity fixture P0 item 2: load-side status (non-200 envelope renders +error).
module load_status_page

pub struct LoadStatusProps {
pub:
	dummy string
}

@[load]
pub fn load_status(req SwelteRequest) !SwelteLoadResult {
	_ = req
	return SwelteLoadResult{
		status: 404
		body: json.encode(LoadStatusProps{ dummy: 'gone' })
	}
}

@[get]
pub fn status_probe(req SwelteRequest) string {
	_ = req
	return 'status-ok'
}
