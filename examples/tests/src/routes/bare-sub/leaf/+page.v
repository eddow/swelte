// Parity fixture P1 item 10: layout=false renders outside the wrapper chain.
module bare_sub_leaf_page

pub struct BareSubLeafProps {
pub:
	greeting string
}

@[load]
pub fn load_bare_sub_leaf(req SwelteRequest) !BareSubLeafProps {
	_ = req
	return BareSubLeafProps{ greeting: 'bare leaf' }
}

@[get]
pub fn bare_leaf_probe(req SwelteRequest) string {
	_ = req
	return 'bare-ok'
}
