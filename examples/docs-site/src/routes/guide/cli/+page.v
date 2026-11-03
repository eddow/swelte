module guide_cli_page

@[get]
pub fn ping(req SwelteRequest) string {
	_ = req
	return 'ok'
}
