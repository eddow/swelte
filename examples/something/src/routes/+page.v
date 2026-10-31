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

// Narrow-args probe: typed verb fn (form → query → params). Projects inline as
// `args: { name: string; age: number; nick?: string | null }` — retrievable via
// `Parameters<typeof greet_narrow>[0]`, numbers JSON-stringified on the wire.
@[get('narrow')]
pub fn greet_narrow(name string, age int, nick ?string) string {
	return 'hi ' + name + ' age=' + age.str() + ' nick=' + (nick or { '<none>' })
}
