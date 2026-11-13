// Public Swelte library module (universal): same V compiles native +
// `v -b wasm`. Consumers import it as `my-lib/v/hello.v` (TS) and
// `npm_my_lib.hello` (V); the dogfood `.svelte` demo imports it as
// `#lib/hello/api.v` (local WASM, same module file).
module hello

pub struct HelloArgs {
pub:
	name string
}

@[rpc]
pub fn hello(args HelloArgs) string {
	return 'hello ' + args.name
}
