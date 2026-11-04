// Parity fixture: per-page prerender=false (excluded even under global cover).
module prerender_false_page

pub struct PrerenderFalseProps {
pub:
	greeting string
}

@[load]
pub fn load_prerender_false(req SwelteRequest) !PrerenderFalseProps {
	_ = req
	return PrerenderFalseProps{ greeting: 'prerender-false' }
}

@[get]
pub fn prerender_false_probe(req SwelteRequest) string {
	_ = req
	return 'prerender-false-ok'
}
