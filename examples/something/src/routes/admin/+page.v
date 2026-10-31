// Swelte route handler for `/admin`. Guarded by admin/+route.v @[before].
module admin_page

pub struct AdminProps {
pub:
	user    string
	section string
	org_id  int
}

@[load]
pub fn load_admin(req SwelteRequest, parent AdminRoute_AdminLayout) !AdminProps {
	user := req.headers['x-user'] or { 'unknown' }
	// parent is the ALREADY-BUILT wrapper value — typed field access,
	// no decode, no JSON. Precedence is unidirectional (route → page),
	// so the leaf knows the wrapper's shape: the layout contract.
	return AdminProps{
		user: user
		section: parent.section
		org_id: parent.org_id
	}
}

@[get]
pub fn admin_whoami(req SwelteRequest) string {
	user := req.headers['x-user'] or { 'unknown' }
	return 'admin:' + user
}
