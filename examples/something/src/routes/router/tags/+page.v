module router_tags_page

// Item 1 leaf: the tag registry is pure client-side (@swelte/core).
// The .v exists only to give the URL a dispatch arm — no @[load]
// needed (page is svelte-only, like /router/live's data path).
@[get]
pub fn tags_probe(req SwelteRequest) string {
	_ = req
	return '{}'
}