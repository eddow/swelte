module main

import net.http
import net.urllib
import json
import x.json2
import os
import time

struct Hand {}

struct Session {
pub:
	id         string
	user       string
	remember   bool
	expires_at time.Time
}

struct LoginArgs {
pub:
	payload string
}

struct GetGreetingArgs {
pub:
	payload string
}

struct SaveNameArgs {
pub:
	payload string
}

struct HashArgs {
pub:
	input string
}

fn arg_str(args map[string]json2.Any, key string) string {
	v := args[key] or { return '' }
	return match v {
		string { v }
		else { v.str() }
	}
}

fn json_str(s string) string {
	return json.encode(s)
}

fn err_unknown(path string, fn_name string, available []string) (int, string) {
	mut avail := '['
	for i, a in available {
		if i > 0 {
			avail += ','
		}
		avail += json.encode(a)
	}
	avail += ']'
	return 404, '{"error":"unknown fn","fn":' + json.encode(fn_name) + ',"path":' + json.encode(path) +
		',"available":' + avail + '}'
}

fn err_bad(path string, fn_name string, detail string) (int, string) {
	return 400, '{"error":' + json.encode(detail) + ',"fn":' + json.encode(fn_name) + ',"path":' +
		json.encode(path) + '}'
}

fn route(path string, method http.Method, query map[string]string, body string) (int, string) {
	if path == '/' {
		// --- #routes/index.v ---
		self_get := ['get_greeting']
		self_post := ['save_name']
		if method == .get {
			fn_name := query['fn'] or { '' }
			if fn_name == 'get_greeting' {
				raw := query['payload'] or { '""' }
				name := json2.decode[string](raw) or { raw }
				return 200, json_str('Hello, ' + name + '!')
			}
			if fn_name == '' {
				return err_bad(path, fn_name, 'missing ?fn=')
			}
			return err_unknown(path, fn_name, self_get)
		}
		if method == .post {
			parsed := json2.decode[map[string]json2.Any](body) or {
				return err_bad(path, '', 'bad json body, want {"fn","args"}')
			}
			fn_any := parsed['fn'] or { return err_bad(path, '', 'missing "fn" in body') }
			fn_name := fn_any.str().trim('"')
			args_any := parsed['args'] or { json2.Any(json2.null) }
			mut args := map[string]json2.Any{}
			if args_any is map[string]json2.Any {
				args = args_any as map[string]json2.Any
			}
			if fn_name == 'save_name' {
				name := arg_str(args, 'payload')
				return 200, json_str('saved:' + name)
			}
			if fn_name == '' {
				return err_bad(path, fn_name, 'missing "fn" in body')
			}
			return err_unknown(path, fn_name, self_post)
		}
		return 405, '{"error":"method not allowed"}'
	}
	if path == '/api/greet' {
		greet_get := ['get_greeting']
		greet_rpc := ['login']
		if method == .get {
			fn_name := query['fn'] or { '' }
			if fn_name == 'get_greeting' {
				raw := query['payload'] or { '""' }
				name := json2.decode[string](raw) or { raw }
				return 200, json_str('Hello, ' + name + '! from Swelte V backend')
			}
			if fn_name == '' {
				return err_bad(path, fn_name, 'missing ?fn=')
			}
			return err_unknown(path, fn_name, greet_get)
		}
		if method == .post {
			parsed := json2.decode[map[string]json2.Any](body) or {
				return err_bad(path, '', 'bad json body, want {"fn","args"}')
			}
			fn_any := parsed['fn'] or { return err_bad(path, '', 'missing "fn" in body') }
			fn_name := fn_any.str().trim('"')
			args_any := parsed['args'] or { json2.Any(json2.null) }
			mut args := map[string]json2.Any{}
			if args_any is map[string]json2.Any {
				args = args_any as map[string]json2.Any
			}
			if fn_name == 'login' {
				args_json := json2.encode(args_any)
				login_args := json.decode(LoginArgs, args_json) or {
					return err_bad(path, fn_name, 'bad args for login')
				}
				if login_args.payload == '' {
					return err_bad(path, fn_name, 'missing payload')
				}
				sess := Session{
					id: 'sess_' + login_args.payload
					user: login_args.payload
					remember: true
					expires_at: time.now()
				}
				return 200, json.encode(sess)
			}
			if fn_name == '' {
				return err_bad(path, fn_name, 'missing "fn" in body')
			}
			return err_unknown(path, fn_name, greet_rpc)
		}
		return 405, '{"error":"method not allowed"}'
	}
	return 404, '{"error":"not found"}'
}

fn (h Hand) handle(req http.Request) http.Response {
	mut r := http.Response{}
	r.header.set(.content_type, 'application/json')
	url := req.url
	path := if url.contains('?') { url.all_before('?') } else { url }
	mut query := map[string]string{}
	if url.contains('?') {
		for part in url.all_after('?').split('&') {
			kv := part.split('=')
			if kv.len == 2 {
				query[urllib.query_unescape(kv[0]) or { kv[0] }] = urllib.query_unescape(kv[1]) or {
					kv[1]
				}
			}
		}
	}
	status, body := route(path, req.method, query, req.data)
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
