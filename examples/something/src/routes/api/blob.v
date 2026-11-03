// Binary + raw-body leaf: []u8 return (octet-stream) and req.raw_body echo.
module blob

@[get]
pub fn blob_bytes(req SwelteRequest) []u8 {
	_ = req
	return 'BLOB-fixture'.bytes()
}

@[post('hook')]
pub fn hook_raw(req SwelteRequest) string {
	return 'raw:' + req.raw_body.bytestr().len.str()
}
