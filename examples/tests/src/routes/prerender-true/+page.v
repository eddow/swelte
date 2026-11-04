// Parity fixture: per-page prerender=true (crawled even under entries:'off').
module prerender_true_page

pub struct PrerenderTrueProps {
pub:
	greeting string
}

@[load]
pub fn load_prerender_true(req SwelteRequest) !PrerenderTrueProps {
	_ = req
	return PrerenderTrueProps{ greeting: 'prerender-true' }
}

@[get]
pub fn prerender_true_probe(req SwelteRequest) string {
	_ = req
	return 'prerender-true-ok'
}
