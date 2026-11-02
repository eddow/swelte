// Item 8: optional-segment leaf. [[slug]] matches zero-or-one: /docs +
// /docs/x → 200 (slug '' vs 'x'), /docs/x/y → 404.
module docs_slug

@[get]
pub fn docs_page(req SwelteRequest) string {
	slug := req.params['slug'] or { '' }
	return 'docs:' + slug
}
