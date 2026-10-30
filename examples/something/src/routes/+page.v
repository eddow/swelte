// Swelte route handler for `/`. Named fns importable from `#routes/+page.v`.
module plus_page

@[get]
pub fn get_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { '""' }
	return 'Hello, ' + name.trim('"') + '!'
}

@[post]
pub fn save_name(req SwelteRequest) string {
	name := req.form['payload'] or { '' }
	return 'saved:' + name
}
