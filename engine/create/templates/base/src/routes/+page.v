// Swelte route handler for `/`.
module plus_page

@[get]
pub fn hello(req SwelteRequest) string {
	return 'Hello from __NAME__'
}
