// Swelte isomorphic lib. Same V compiles to native + `v -b wasm`.
// Importable from `#lib/crypto/hash.v`; local WASM call, no fetch.
module crypto

pub struct HashArgs {
pub:
	input string
}

@[rpc]
pub fn hash_string(args HashArgs) string {
	return 'hash(' + args.input + ')'
}
