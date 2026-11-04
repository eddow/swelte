// Parity fixture P1 item 6: csr=false renders SSR HTML only —
// the client mount/hydrate is a deliberate no-op.
module no_csr_page

pub struct NoCsrProps {
pub:
	greeting string
}

@[load]
pub fn load_no_csr(req SwelteRequest) !NoCsrProps {
	_ = req
	return NoCsrProps{ greeting: 'no-csr paint' }
}

@[get]
pub fn no_csr_probe(req SwelteRequest) string {
	_ = req
	return 'no-csr-ok'
}
