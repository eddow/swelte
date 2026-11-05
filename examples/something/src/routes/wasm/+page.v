// WASM demo: isomorphic lib call (dev fallback until `v -b wasm` lands).
module wasm_page

@[get]
pub fn wasm_hint(req SwelteRequest) string {
	_ = req
	return 'wasm: hash_string via #lib'
}
