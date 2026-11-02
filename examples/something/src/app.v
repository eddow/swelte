// Item 9: app lifecycle. @[startup] runs once before veb.run (throw aborts
// boot); @[reroute] rewrites (host, path) before trailingSlash/CORS/dispatch
// ('' = no-op). /old → /router served without redirect. Exactly one fn each,
// no qualifier; startup takes no params and returns void, reroute takes
// (host string, path string) and returns string.
module app

@[startup]
pub fn boot() {
	println('[swelte] boot (item 9)')
}

@[reroute]
pub fn rewrite(host string, path string) string {
	if path == '/old' {
		return '/router'
	}
	return ''
}
