// Parity fixture P2 item 1: async paginated entries() for the crawl.
// Runs at generate time in Node; the loop shape proves awaited pagination.
module dyn_item_page

@[get]
pub fn dyn_item(req SwelteRequest) string {
	id := req.params['id'] or { '' }
	return 'dyn-item:' + id
}
