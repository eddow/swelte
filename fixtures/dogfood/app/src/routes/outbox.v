module outbox

import os

@[post]
pub fn deliver(req SwelteRequest) SwelteResponse {
	mode := req.query['mode'] or { '' }
	if mode == 'gated' && !os.exists('outbox-online') { return SwelteResponse{
			status: 503
		} }
	if mode == 'retry' { return SwelteResponse{
			status:  503
			headers: {
				'Retry-After': '1'
			}
			body:    'retry'
		} }
	if mode == 'reject' { return SwelteResponse{
			status: 400
			body:   'rejected'
		} }
	key := req.headers['Idempotency-Key'] or { req.headers['idempotency-key'] or { '' } }
	if key.len != 36 || key.contains('/') { return SwelteResponse{
			status: 400
		} }
	os.write_file('outbox-' + key, req.raw_body.bytestr()) or {
		return SwelteResponse{
			status: 500
		}
	}
	return SwelteResponse{
		body: 'delivered'
	}
}
