// Shared helper fixture (roadmap §17): UNIQUE basename across the project,
// so editors resolve `./sibling.v` to the real signature (ambiguous
// basenames like `+page.v` keep the `*.v` fallback — use `#`-aliases).
module sibling

pub struct GreetIn {
pub:
	name string
}

@[rpc]
pub fn g(args GreetIn) string {
	return 'hi ' + args.name
}
