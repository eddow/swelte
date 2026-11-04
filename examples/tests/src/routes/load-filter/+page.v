// Parity fixture P2 item 2: serializedHeaders allowlist — only x-keep lands
// on the HTML navigation; x-drop is filtered. Location always passes (see
// load-redirect which has no allowlist).
module load_filter_page

pub struct LoadFilterProps {
pub:
	greeting string
}

@[load]
pub fn load_filter(req SwelteRequest) !SwelteLoadResult {
	_ = req
	return SwelteLoadResult{
		status: 200
		headers: {'X-Keep': 'kept', 'X-Drop': 'dropped'}
		body: json.encode(LoadFilterProps{ greeting: 'filtered' })
	}
}

@[get]
pub fn filter_probe(req SwelteRequest) string {
	_ = req
	return 'filtered-ok'
}
