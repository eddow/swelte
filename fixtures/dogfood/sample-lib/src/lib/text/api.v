module text

pub struct NormalizeArgs {
pub:
	input string
}

@[rpc]
pub fn normalize(args NormalizeArgs) string {
	return args.input
}
