// Parity fixture P1 item 9: link preload/reload options survive SSR HTML.
// Click/hover/goto/preloadCode behavior stays client-side (unit-pinned in
// sdk-errors.test.ts); e2e pins the attributes reach the served HTML.
module preload_page

@[get]
pub fn preload_probe(req SwelteRequest) string {
	_ = req
	return 'preload-ok'
}
