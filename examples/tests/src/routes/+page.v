// Minimal home route: GET probe + @[load] paint for SSR.
module plus_page

pub struct HomeProps {
pub:
	greeting string
}

@[load]
pub fn load_home(req SwelteRequest) !HomeProps {
	name := req.query['who'] or { 'tests' }
	return HomeProps{
		greeting: 'hello ' + name
	}
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
