module main

import net.http
import net.http.mime
import net.urllib
import os
import routes
import strconv
import sync
import time

// §11 Hardening (global, in Hand — never in `+route.v` middleware):
// body-size cap (413), per-IP fixed-window rate limit (429), handler
// timeout via spawn + select (slow handlers report 500, server stays up;
// timed-out threads still run to completion in the background, so a burst
// of slow handlers still costs a thread each).
// Single-instance in-memory only; multi-instance deploys approximate.
// Stale rate-limit buckets are evicted opportunistically (see below).
// Env knobs (unset/invalid/0/negative = built-in default):
//   SWELTE_BODY_LIMIT  max req.data bytes before routing (default 10MB)
//   SWELTE_RATE_LIMIT  requests per IP per window (default 120)
//   SWELTE_RATE_WINDOW_MS  window length (default 60000)
//   SWELTE_HANDLER_TIMEOUT_MS  handler budget (default 10000)
const swelte_default_body_limit = 10 * 1024 * 1024
const swelte_default_rate_limit = 120
const swelte_default_rate_window_ms = i64(60 * 1000)
const swelte_default_handler_timeout_ms = i64(10 * 1000)

fn swelte_env_int(key string, fallback i64) i64 {
	raw := os.getenv_opt(key) or { return fallback }
	v := strconv.parse_int(raw, 10, 64) or { return fallback }
	if v <= 0 {
		return fallback
	}
	return v
}

fn swelte_body_limit() int {
	return int(swelte_env_int('SWELTE_BODY_LIMIT', swelte_default_body_limit))
}

fn swelte_rate_limit() int {
	return int(swelte_env_int('SWELTE_RATE_LIMIT', swelte_default_rate_limit))
}

fn swelte_rate_window_ms() i64 {
	return swelte_env_int('SWELTE_RATE_WINDOW_MS', swelte_default_rate_window_ms)
}

fn swelte_handler_timeout_ms() i64 {
	return swelte_env_int('SWELTE_HANDLER_TIMEOUT_MS', swelte_default_handler_timeout_ms)
}

struct SwelteBucket {
mut:
	window_start i64
	count        int
}

// §11 rate-limit state lives on the handler: `handle` takes `mut h`,
// so per-connection calls share the map under a mutex. No `__global`
// (needs `-enable-globals`); single-instance in-memory only.
struct Hand {
mut:
	buckets map[string]SwelteBucket
	mu      sync.Mutex
}

fn (mut h Hand) swelte_rate_limited(ip string) bool {
	limit := swelte_rate_limit()
	window := swelte_rate_window_ms()
	now := time.now().unix_milli()
	h.mu.lock()
	defer {
		h.mu.unlock()
	}
	// Opportunistic eviction: drop buckets idle for 2 windows so the map
	// cannot grow without bound (memory-DoS vector). Linear scan under
	// the mutex — fine at dev/prod-single-instance scale.
	for k, v in h.buckets {
		if now - v.window_start >= 2 * window {
			h.buckets.delete(k)
		}
	}
	mut b := h.buckets[ip] or { SwelteBucket{window_start: now} }
	if now - b.window_start >= window {
		b.window_start = now
		b.count = 0
	}
	b.count += 1
	h.buckets[ip] = b
	return b.count > limit
}

// Route-call inputs cross the spawn boundary for the timeout watchdog.
struct SwelteRouteCall {
	path         string
	method       string
	query        map[string]string
	headers      map[string]string
	cookies      map[string]string
	body         string
	content_type string
	qualifier    string
}

struct SwelteRouteOut {
	status      int
	body        string
	set_cookies []string
}

fn swelte_route_spawned(c SwelteRouteCall, ch chan SwelteRouteOut) {
	status, body, set_cookies := routes.swelte_route(c.path, c.method, c.query,
		c.headers, c.cookies, c.body, c.content_type, c.qualifier)
	ch <- SwelteRouteOut{status, body, set_cookies}
}

fn swelte_call_route(path string, method string, query map[string]string, headers map[string]string, cookies map[string]string, body string, content_type string, qualifier string) SwelteRouteOut {
	budget := swelte_handler_timeout_ms()
	ch := chan SwelteRouteOut{cap: 1}
	call := SwelteRouteCall{path, method, query, headers, cookies, body, content_type,
		qualifier}
	spawn swelte_route_spawned(call, ch)
	select {
		out := <-ch {
			return out
		}
		budget * time.millisecond {
			return SwelteRouteOut{500, '{"error":"handler timeout"}', []string{}}
		}
	}
	// Unreachable: select always returns via the channel or the timeout.
	return SwelteRouteOut{500, '{"error":"handler timeout"}', []string{}}
}

fn swelte_html_escape(s string) string {
	mut out := s
	out = out.replace('&', '&amp;')
	out = out.replace('<', '&lt;')
	out = out.replace('>', '&gt;')
	out = out.replace('"', '&quot;')
	return out
}

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

fn (mut h Hand) handle(req http.Request) http.Response {
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
	// §11 Hardening: client IP comes from the server-injected Remote-Addr
	// header (V net.http adds it from conn.peer_ip in server.v — never
	// X-Forwarded-For, which is client-controlled and spoofable).
	ip := headers['Remote-Addr'] or { '0.0.0.0' }
	if h.swelte_rate_limited(ip) {
		r.header.set(.content_type, 'application/json')
		r.status_code = 429
		r.body = '{"error":"rate limited"}'
		return r
	}
	// §11 Hardening: body cap before routing (multipart included —
	// uploads in §13 live under the same knob).
	if req.data.len > swelte_body_limit() {
		r.header.set(.content_type, 'application/json')
		r.status_code = 413
		r.body = '{"error":"body too large"}'
		return r
	}
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
	// §11 Hardening: handler timeout watchdog — slow handlers report 500,
	// the server keeps serving (the timed-out thread still runs to completion
	// in the background — its send drops; a burst of slow handlers still
	// costs a thread each).
	out := swelte_call_route(path, req.method.str().to_upper(), query, headers, cookies, req.data, content_type, qualifier)
	status := out.status
	body := out.body
	set_cookies := out.set_cookies
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
	// §12 No-JS forms: browser navigations (Accept: text/html, no JSON)
	// get a redirect on success / server-rendered error page on failure
	// instead of JSON. Fetch stubs (Accept: application/json) keep JSON.
	wants_html := headers['Accept'] or { headers['accept'] or { '' } }.contains('text/html')
		&& !(headers['Accept'] or { headers['accept'] or { '' } }.contains('application/json'))
	if wants_html && status == 200 {
		r.header.set(.location, path)
		for c in cookies_out {
			r.header.add(.set_cookie, c)
		}
		if cors_ok {
			r.header.set(.access_control_allow_origin, if cors_origin == '*' { '*' } else { origin })
			r.header.set_custom('Access-Control-Allow-Credentials', 'true') or {}
		}
		r.status_code = 303
		r.body = ''
		return r
	}
	if wants_html && status >= 400 {
		mut msg := body.all_after('"error":"')
		if msg != body {
			msg = msg.all_before('"')
		}
		r.header.set(.content_type, 'text/html; charset=utf-8')
		r.status_code = status
		r.body = '<!doctype html><html><body><p>' + swelte_html_escape(msg) + '</p><p><a href="' + path + '">back</a></p></body></html>'
		return r
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
