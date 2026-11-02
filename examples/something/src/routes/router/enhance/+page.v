// Item 15a: use:enhance leaf. POST ?echo arm returns the payload as JSON;
// the .svelte posts a plain <form method=post use:enhance> and asserts
// page.form publish + reset without reload.
module router_enhance

@[get]
pub fn enhance_probe(req SwelteRequest) string {
	return 'enhance:post-the-form'
}

@[post('echo')]
pub fn enhance_echo(req SwelteRequest) string {
	name := req.form['payload'] or { req.query['payload'] or { '' } }
	return '{"ok":true,"name":"' + name + '"}'
}
