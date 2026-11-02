// Minimal isomorphic lib: pure @[rpc] (WASM/dev-fallback path).
module calc

pub struct AddArgs {
pub:
	a int
	b int
}

@[rpc]
pub fn add(args AddArgs) int {
	return args.a + args.b
}
