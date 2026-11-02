// Item 8: route-group leaf. (mkt) is disk-only — stripped from the URL,
// so this file serves /about (never ship a group-only (mkt)/+page: that
// claims `/` and double-claims with the existing `/` leaf).
module mkt_about

@[get]
pub fn mkt_about(req SwelteRequest) string {
	return 'about:mkt-group'
}
