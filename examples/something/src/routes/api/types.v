// Type-table leaf: bool/float/array/map/optional/time.Time in one struct.
// Narrow-args probe covers typed verb params (int/float/bool/?string).
module typetable

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
