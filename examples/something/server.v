module main

import net.http
import net.http.mime
import net.urllib
import os
import routes

struct Hand {}

fn mime_for(path string) string {
	if path.to_lower().ends_with('.wasm') {
		return 'application/wasm'
	}
	ext := path.all_after_last('.').to_lower()
	if ext == '' {
		return 'application/octet-stream'
	}
	mt := mime.get_mime_type(ext)
	if mt == '' {
		return 'application/octet-stream'
	}
	if mt.starts_with('text/') || mt == 'application/javascript' {
		return mime.get_content_type(mt)
	}
	return mt
}

fn serve_static(dist string, path string) (int, string, string) {
	mut rel := path
	if rel.contains('?') {
		rel = rel.all_before('?')
	}
	if rel.ends_with('/') {
		rel += 'index.html'
	}
	if rel.starts_with('/') {
		rel = rel[1..]
	}
	if rel == '' {
		rel = 'index.html'
	}
	if rel.contains('..') {
		return 403, 'application/json', '{"error":"forbidden"}'
	}
	full := dist + '/' + rel
	if !os.exists(full) || os.is_dir(full) {
		index := dist + '/index.html'
		if os.exists(index) {
			data := os.read_bytes(index) or { return 500, 'application/json', '{"error":"read failed"}' }
			return 200, 'text/html; charset=utf-8', data.bytestr()
		}
		return 404, 'application/json', '{"error":"not found"}'
	}
	data := os.read_bytes(full) or { return 500, 'application/json', '{"error":"read failed"}' }
	return 200, mime_for(rel), data.bytestr()
}

fn (h Hand) handle(req http.Request) http.Response {
	mut r := http.Response{}
	url := req.url
	path := if url.contains('?') { url.all_before('?') } else { url }
	cors_origin := os.getenv_opt('SWELTE_CORS_ORIGIN') or { '' }
	origin := req.header.get_custom('Origin') or { '' }
	cors_ok := cors_origin != '' && (cors_origin == '*' || cors_origin == origin)
	if req.method == .options {
		if cors_ok {
			r.header.set(.access_control_allow_origin, if cors_origin == '*' { '*' } else { origin })
			r.header.set_custom('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS') or {}
			r.header.set_custom('Access-Control-Allow-Headers', 'Content-Type, Accept') or {}
			r.header.set_custom('Access-Control-Max-Age', '86400') or {}
		}
		r.status_code = 204
		return r
	}
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
	status, body, set_cookies := routes.swelte_route(path, req.method.str().to_upper(), query, headers, cookies, req.data, content_type, qualifier)
	if !cors_ok && origin != '' && req.method != .get && req.method != .head {
		r.header.set(.content_type, 'application/json')
		r.status_code = 403
		r.body = '{"error":"forbidden"}'
		return r
	}
	dist := os.getenv_opt('SWELTE_DIST') or { '' }
	if dist != '' && req.method == .get && !path.starts_with('/api/') && (path == '/' || (status == 404 && body.contains('not found'))) {
		s, ct, sb := serve_static(dist, path)
		r.header.set(.content_type, ct)
		r.status_code = s
		r.body = sb
		return r
	}
	mut cookies_out := set_cookies.clone()
	if status == 200 && cookies_out.len > 0 {
		mut sess := ''
		after_id := body.all_after('"id":"')
		if after_id != body {
			sess = after_id.all_before('"')
		}
		if sess != '' {
			for i in 0 .. cookies_out.len {
				cookies_out[i] = cookies_out[i].replace('sess=__SWELTE_SESS__', 'sess=' + sess)
			}
		} else {
			cookies_out = []string{}
		}
	}
	r.header.set(.content_type, 'application/json')
	for c in cookies_out {
		r.header.add(.set_cookie, c)
	}
	if cors_ok {
		r.header.set(.access_control_allow_origin, if cors_origin == '*' { '*' } else { origin })
		r.header.set_custom('Access-Control-Allow-Credentials', 'true') or {}
	}
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
