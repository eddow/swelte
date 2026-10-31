// Swelte catch-all fixture (roadmap item 8).
module files_rest

@[get]
pub fn file_detail(req SwelteRequest) string {
	rest := req.params['rest'] or { '' }
	return 'files:' + rest
}
