module guide_forms_page

@[get]
pub fn ping(req SwelteRequest) string {
	_ = req
	return 'ok'
}
