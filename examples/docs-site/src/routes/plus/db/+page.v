module plus_db_page

@[get]
pub fn ping(req SwelteRequest) string {
	_ = req
	return 'ok'
}
