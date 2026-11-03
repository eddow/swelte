// Docs home: static shell — load carries the tagline for SSR,
// GET arm keeps the API dispatch 200 (probe + smoke contract).
module plus_page

pub struct DocsHome {
pub:
	tagline string
}

@[get]
pub fn ping(req SwelteRequest) string {
	_ = req
	return 'Swelte docs'
}

@[load]
pub fn load_home(req SwelteRequest) !DocsHome {
	_ = req
	return DocsHome{
		tagline: 'V + Svelte full-stack — agents in, binaries out.'
	}
}
