// Embedded KV store demo (future.md #2): `import backend` shared conn +
// kv_get/kv_set/kv_del over a single SQLite file. Needs dbPlugin.
module store

import backend

pub struct KvIn {
pub:
	key   string
	value string
}

@[get]
pub fn kv_read(req SwelteRequest) !string {
	key := req.query['key'] or { return error('missing key') }
	return backend.kv_get(key)!
}

@[post]
pub fn kv_write(req SwelteRequest) !string {
	key := req.form['key'] or { req.query['key'] or { return error('missing key') } }
	val := req.form['value'] or { req.query['value'] or { '' } }
	backend.kv_set(key, val)!
	return 'ok:' + key
}

@[delete]
pub fn kv_drop(req SwelteRequest) !string {
	key := req.query['key'] or { return error('missing key') }
	backend.kv_del(key)!
	return 'dropped:' + key
}

@[get('listeners')]
pub fn hub_count(req SwelteRequest) string {
	room := req.query['room'] or { 'lobby' }
	return backend.hub_listeners(room).str()
}
