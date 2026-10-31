// Swelte dynamic-segment fixture (roadmap item 8).
module users_id

@[get]
pub fn user_detail(req SwelteRequest) string {
	id := req.params['id'] or { '' }
	return 'user:' + id
}
