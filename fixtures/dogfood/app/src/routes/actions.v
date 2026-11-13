module actions

import os

@[post('save')]
pub fn save(req SwelteRequest) SwelteResponse {
	os.write_file('action-executed', 'yes') or { return SwelteResponse{status: 500} }
	return SwelteResponse{body: '{"unrelated":true}'}
}
