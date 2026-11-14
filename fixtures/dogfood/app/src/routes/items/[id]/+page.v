module item

pub struct ItemData {
pub:
	id string
	search string
	locale string
}

@[load]
pub fn load_item(req SwelteRequest, parent Route_LayoutData) !ItemData {
	if req.params['id'] == 'denied' { return swelte_error(403, 'item denied') }
	return ItemData{req.params['id'], req.query['q'] or { '' }, parent.locale}
}
