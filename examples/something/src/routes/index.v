// Swelte route handler for `/`. Named fns importable from `#routes/index.v`.
module index

pub struct GetGreetingArgs {
pub:
	payload string
}

pub struct SaveNameArgs {
pub:
	payload string
}

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
