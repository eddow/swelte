// Verbs probe: HEAD auto-handling on the GET arm, OPTIONS preflight,
// and the 405 arm (DELETE has no handler here).
module verbs_page

@[get]
pub fn verbs_probe(req SwelteRequest) string {
	name := req.query['who'] or { 'verbs' }
	return 'verbs:' + name
}

@[post('echo')]
pub fn verbs_echo(req SwelteRequest) string {
	name := req.form['payload'] or { req.query['payload'] or { '' } }
	return 'echo:' + name
}
