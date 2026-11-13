module threads

import backend

pub struct ThreadsData {
pub:
	threads []backend.Thread
	search string
}

@[load]
pub fn load_threads(req SwelteRequest, parent Route_LayoutData) !ThreadsData {
	search := req.query['q'] or { '' }
	return ThreadsData{backend.list_threads(search)!, search}
}

@[post('add')]
pub fn add(req SwelteRequest) !SwelteResponse {
	title := req.form['title'] or { '' }
	if title.trim_space() == '' { return SwelteResponse{status: 422, body: '{"fieldErrors":{"title":"required"}}'} }
	backend.add_thread(title)!
	return SwelteResponse{body: '{"saved":true}'}
}
