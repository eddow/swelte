module layout

pub struct LayoutData {
pub:
	locale string
}

@[before]
pub fn prepare(input SwelteRequest) !SwelteRequest {
	if input.query['deny'] == '1' { return swelte_redirect_error('/?login=1', 303) }
	mut req := input
	req.locals['locale'] = req.params['lang'] or { req.query['lang'] or { 'en' } }
	req.locals['prepared'] = 'yes'
	return req
}

@[after]
pub fn decorate(req SwelteRequest, input SwelteResponse) !SwelteResponse {
	mut res := input
	res.headers['X-Dogfood-Guard'] = req.locals['prepared'] or { 'missing' }
	if req.path == '/isr' { return res }
	res.cookies << SwelteCookie{name: 'first', value: '1', path: '/'}
	res.cookies << SwelteCookie{name: 'second', value: '2', path: '/'}
	return res
}

@[load]
pub fn load_layout(req SwelteRequest) !LayoutData {
	if req.locals['prepared'] != 'yes' { return error('lost middleware context') }
	return LayoutData{req.locals['locale']}
}
