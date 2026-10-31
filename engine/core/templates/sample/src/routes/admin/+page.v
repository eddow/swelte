// Swelte route handler for `/admin`. Guarded by admin/+route.v @[before].
module admin_page

@[get]
pub fn admin_whoami(req SwelteRequest) string {
	user := req.headers['x-user'] or { 'unknown' }
	return 'admin:' + user
}
