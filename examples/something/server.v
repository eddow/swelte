module main

import net.http
import net.urllib
import os
import routes

struct Hand {}

fn (h Hand) handle(req http.Request) http.Response {
	mut r := http.Response{}
	r.header.set(.content_type, 'application/json')
	url := req.url
	path := if url.contains('?') { url.all_before('?') } else { url }
	mut query := map[string]string{}
	if url.contains('?') {
		for part in url.all_after('?').split('&') {
			if part == '' {
				continue
			}
			idx := part.index('=') or { -1 }
			if idx < 0 {
				// Bare key (`?delete`): qualifier trigger, value is presence.
				query[urllib.query_unescape(part) or { part }] = ''
			} else {
				k := part[..idx]
				v := part[idx + 1..]
				query[urllib.query_unescape(k) or { k }] = urllib.query_unescape(v) or { v }
			}
		}
	}
	mut headers := map[string]string{}
	for k in req.header.keys() {
		if v := req.header.get_custom(k) {
			headers[k] = v
		}
	}
	mut cookies := map[string]string{}
	if c := req.header.get(.cookie) {
		for part in c.split(';') {
			kv := part.split('=')
			if kv.len == 2 {
				cookies[kv[0].trim_space()] = kv[1].trim_space()
			}
		}
	}
	content_type := req.header.get(.content_type) or { '' }
	mut qualifier := query['q'] or { '' }
	if qualifier == '' {
		for k, v in query {
			// First bare key (`?delete`, value == '') doubles as qualifier.
			// Real args (`?payload=x`) have values and are skipped.
			if v == '' {
				qualifier = k
				break
			}
		}
	}
	status, body := routes.swelte_route(path, req.method.str().to_upper(), query, headers, cookies, req.data, content_type, qualifier)
	r.status_code = status
	r.body = body
	return r
}

fn main() {
	port := os.getenv_opt('PORT') or { '8131' }
	mut s := http.Server{
		addr: ':' + port
		handler: Hand{}
		show_startup_message: false
	}
	println('swelte-v-backend listening on :' + port)
	s.listen_and_serve()
}
