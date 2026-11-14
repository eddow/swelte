module item

pub struct ItemData {
pub:
	id string
	search string
	locale string
}

@[load]
pub fn load_item(req SwelteRequest, parent Route_LayoutData) !ItemData {
	return ItemData{req.params['id'], req.query['q'] or { '' }, parent.locale}
}
