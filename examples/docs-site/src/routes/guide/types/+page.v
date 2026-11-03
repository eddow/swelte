module guide_types_page

@[get]
pub fn ping(req SwelteRequest) string {
	_ = req
	return 'ok'
}
