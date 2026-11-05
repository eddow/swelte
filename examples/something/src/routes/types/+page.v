// Types + bytes demo: TypeRow struct + narrow-args calc + binary/raw probes.
module types_page

import time

pub struct TypeRow {
pub:
	name     string
	count    int
	ratio    f64
	active   bool
	tags     []string
	meta     map[string]string
	nick     ?string
	stamp    time.Time
}

@[get('row')]
pub fn type_row(req SwelteRequest) TypeRow {
	_ = req
	return TypeRow{
		name: 'demo'
		count: 3
		ratio: 1.5
		active: true
		tags: ['a', 'b']
		meta: {'k': 'v'}
		nick: none
		stamp: time.now()
	}
}

@[get('calc')]
pub fn calc_probe(count int, ratio f64, active bool, nick ?string) string {
	return 'calc:' + count.str() + ':' + ratio.str() + ':' + active.str() + ':' + (nick or { '<none>' })
}

@[get]
pub fn blob_bytes(req SwelteRequest) []u8 {
	_ = req
	return 'BLOB-fixture'.bytes()
}

@[post('hook')]
pub fn hook_raw(req SwelteRequest) string {
	return 'raw:' + req.raw_body.bytestr().len.str()
}
