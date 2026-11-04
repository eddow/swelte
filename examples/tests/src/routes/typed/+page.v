// Parity fixture P0 item 3: typed errors with status preservation.
// `return swelte_error(403, ...)` from a verb/load keeps the 403 —
// plain `return error('...')` keeps the 400 default. Both land in +error.
module typed_page

pub struct TypedProps {
pub:
	dummy string
}

@[load]
pub fn load_typed(req SwelteRequest) !TypedProps {
	// Bare `?fail` would be consumed as a ?q qualifier before dispatch —
	// use a valued param so the load actually sees it.
	if req.query['mode'] or { '' } == 'fail' {
		return swelte_error(403, 'forbidden-typed')
	}
	return TypedProps{ dummy: 'typed-ok' }
}

@[get]
pub fn typed_probe(req SwelteRequest) string {
	// Default JSON probe. HTML nav goes through @[load].
	_ = req
	return 'typed-probe-ok'
}

@[get('deny')]
pub fn deny_typed(req SwelteRequest) !string {
	// ?deny → typed 403 (status preserved via swelte_err_typed).
	_ = req
	return swelte_error(403, 'forbidden-typed')
}
