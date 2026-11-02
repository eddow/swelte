// Swelte route handler for `/router` — §1 data-loading/client-router illustration.
// Server-only @[load] (initial paint) + @[get] (JSON probe for preloadData/goto).
// All async (fetch/db/…) lives HERE (ssr=true): the .svelte stays pure-sync
// (no fetch/await/stub calls at top level — SSR build errors by design).
module router_page

pub struct RouterProps {
pub:
	greeting     string
	ts           string
	sibling_rows string
}

// Server @[load]: Hand threads this root-first into props_json; SSR
// renderRoute merges it, client mounts merge the same shape
// (leafProps = { params, ...data }). Sibling-route rows arrive via
// in-process swelte_fetch (no loopback socket, V-only — non-fallible).
@[load]
pub fn load_router(req SwelteRequest) !RouterProps {
	name := req.query['who'] or { 'router' }
	mut out := []SwelteCookie{}
	got := swelte_fetch(req, mut out, 'GET', '/api/greet?payload=' + name, '', '', '')
	return RouterProps{
		greeting: 'hello ' + name + ' (server @[load])'
		ts: req.path
		sibling_rows: got.body
	}
}

@[get]
pub fn router_data(req SwelteRequest) string {
	name := req.query['who'] or { 'router' }
	return 'hello ' + name + ' (JSON @[get] probe)'
}
