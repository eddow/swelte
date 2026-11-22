// Item 9: app lifecycle. @[startup] runs once before veb.run (throw aborts
// boot); @[reroute] rewrites (host, path) before trailingSlash/CORS/dispatch
// ('' = no-op). Exactly one fn each, no qualifier; startup takes no params
// and returns void, reroute takes (host string, path string) and returns
// string. @[cron] ticks are Plus-owned (jobsPlugin registered in
// vite.config.ts; inert without it) — one-or-more fns, duration qualifier,
// idempotent bodies, no watchdog.
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

@[cron('60s')]
pub fn tick() {
	println('[swelte] tick (item 9: cron 60s)')
}
