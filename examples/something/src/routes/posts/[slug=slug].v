// Item 7: custom-matcher dynamic leaf. [slug=slug] dispatches only
// on lowercase-alpha segments (V side) and client matchSegs alike.
module posts_slug

@[get]
pub fn post_detail(req SwelteRequest) string {
	slug := req.params['slug'] or { '' }
	return 'post:' + slug
}
