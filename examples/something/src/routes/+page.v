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

// Item 4: fail-lite arm — empty payload yields a 422
// `{ ok: false, fieldErrors }` body; the home page narrows it inline
// with `isFail(e, 422)`. The `?save` qualifier keeps it distinct from
// the default `@[post]` save_name arm (one default per verb).
@[post('save')]
pub fn save_fail(req SwelteRequest) !SwelteResponse {
	name := req.form['payload'] or { req.query['payload'] or { '' } }
	if name == '' {
		fail := '{"ok":false,"fieldErrors":{"payload":"required"}}'
		return SwelteResponse{ status: 422, headers: {'Content-Type': 'application/json'}, body: fail }
	}
	return SwelteResponse{ status: 200, headers: {'Content-Type': 'application/json'}, body: '{"ok":true}' }
}

// Narrow-args probe: typed verb fn (form → query → params). Projects inline as
// `args: { name: string; age: number; nick?: string | null }` — retrievable via
// `Parameters<typeof greet_narrow>[0]`, numbers JSON-stringified on the wire.
@[get('narrow')]
pub fn greet_narrow(name string, age int, nick ?string) string {
	return 'hi ' + name + ' age=' + age.str() + ' nick=' + (nick or { '<none>' })
}
