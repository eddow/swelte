// Store demo: KV over the embedded backend (dbPlugin hub package).
module store_page

@[get]
pub fn store_hint(req SwelteRequest) string {
	_ = req
	return 'store: kv_read/kv_write/kv_drop + hub_count'
}
