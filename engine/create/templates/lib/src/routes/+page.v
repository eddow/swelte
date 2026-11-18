// Library dogfood route for `/`: minimal GET probe. The `.svelte` twin
// exercises the public src/lib surface via `#lib/...` exactly like a
// consumer would. Never published.
module plus_page

@[get]
pub fn hello(req SwelteRequest) string {
	return 'hello dogfood'
}
