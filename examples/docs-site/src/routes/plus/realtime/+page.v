module plus_realtime_page

@[get]
pub fn ping(req SwelteRequest) string {
	_ = req
	return 'ok'
}