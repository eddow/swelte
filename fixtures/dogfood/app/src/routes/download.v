module download

@[get]
pub fn get(req SwelteRequest) SwelteResponse {
	return swelte_bytes([u8(0), 1, 2, 255], 'application/octet-stream')
}
