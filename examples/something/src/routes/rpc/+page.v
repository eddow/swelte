// RPC demo: verbs + pure @[rpc] + narrow args + fail-lite + deserialize envelope.
module rpc_page

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

@[post('save')]
pub fn save_fail(req SwelteRequest) !SwelteResponse {
	name := req.form['payload'] or { req.query['payload'] or { '' } }
	if name == '' {
		fail := '{"ok":false,"fieldErrors":{"payload":"required"}}'
		return SwelteResponse{ status: 422, headers: {'Content-Type': 'application/json'}, body: fail }
	}
	return SwelteResponse{ status: 200, headers: {'Content-Type': 'application/json'}, body: '{"ok":true}' }
}

@[get('narrow')]
pub fn greet_narrow(name string, age int, nick ?string) string {
	return 'hi ' + name + ' age=' + age.str() + ' nick=' + (nick or { '<none>' })
}

@[put]
pub fn rename_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { req.form['payload'] or { '' } }
	return 'renamed:' + name
}

@[patch]
pub fn touch_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { req.form['payload'] or { '' } }
	return 'touched:' + name
}
