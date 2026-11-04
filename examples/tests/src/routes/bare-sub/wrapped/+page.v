// Control leaf under the same wrapper: keeps the full chain (no layout cut).
module bare_sub_wrapped_page

pub struct BareSubWrappedProps {
pub:
	greeting string
}

@[load]
pub fn load_bare_sub_wrapped(req SwelteRequest) !BareSubWrappedProps {
	_ = req
	return BareSubWrappedProps{ greeting: 'wrapped leaf' }
}

@[get]
pub fn wrapped_probe(req SwelteRequest) string {
	_ = req
	return 'wrapped-ok'
}
