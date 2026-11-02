// Swelte API route `/api/greet`. V struct -> TS interface projection.
module greet

import json
import time

pub struct Session {
pub:
	id         string
	user       string
	remember   bool
	expires_at time.Time
}

pub struct LoginArgs {
pub:
	payload string
}

// login is HTTP (sets the sess cookie) → a verb, not @[rpc].
// @[rpc] stays protocol-ignorant: typed args in, typed value out (or throw → reject).
@[post]
pub fn login(req SwelteRequest) !SwelteResponse {
	payload := req.form['payload'] or { req.query['payload'] or { '' } }
	if payload == '' {
		return error('missing payload')
	}
	sess := Session{
		id: 'sess_' + payload
		user: payload
		remember: true
		expires_at: time.now()
	}
	mut res := SwelteResponse{ status: 200, headers: {'Content-Type': 'application/json'}, body: json.encode(sess) }
	res.cookies << SwelteCookie{ name: 'sess', value: sess.id, path: '/', http_only: true, same_site: 'Lax', max_age: 604800 }
	return res
}

@[get]
pub fn get_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { '""' }
	return 'Hello, ' + name.trim('"') + '! from Swelte V backend'
}

@[delete('session')]
pub fn kill_session(req SwelteRequest) string {
	return 'killed'
}

@[delete]
pub fn wipe_sessions(req SwelteRequest) string {
	return 'wiped'
}

// Slow probe (roadmap §11): sleeps `?ms=` ms so the handler-timeout
// watchdog can be exercised (SWELTE_HANDLER_TIMEOUT_MS).
@[get('slow')]
pub fn slow_probe(req SwelteRequest) string {
	ms_str := req.query['ms'] or { '' }
	ms := ms_str.int()
	if ms > 0 {
		time.sleep(time.millisecond * ms)
	}
	return 'slow-ok'
}

@[post('upload')]
pub fn upload_file(req SwelteRequest) !string {
	names := req.files['file'] or { return error('missing file') }
	if names == '' {
		return error('missing file')
	}
	return 'got:' + names
}

// Item 6 proof: full verb set — `@[put]` + `@[patch]` arms alongside
// get/post/delete. Default one-per-verb, JSON round-trip, 405 arm quiet.
@[put]
pub fn rename_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { req.form['payload'] or { '' } }
	return 'renamed:' + name
}

@[patch]
pub fn touch_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { req.form['payload'] or { '' } }
	return 'touched:' + name
}

// Item 5 proof: list-mode SSE on its own headless URL (the mixed
// emit+list file shape is unservable — `swelte_sse_is_emit()` is
// per-file, so one mode per file. Full stream below, Qualifier 404s).
@[sse]
pub fn tick_stream(req SwelteRequest, emit fn (string) bool) {
	n := req.query['n'] or { '3' }
	w := req.query['wait_ms'] or { '0' }
	mut count := n.int()
	if count < 1 {
		count = 1
	}
	if count > 50 {
		count = 50
	}
	wait := w.int()
	for i in 1 .. count + 1 {
		if wait > 0 && wait <= 10000 {
			time.sleep(time.millisecond * wait)
		}
		if !emit('tick ${i}') {
			return
		}
	}
}

// Item 5 proof, list mode on a SEPARATE file (per-file mode —
// mixed emit+list in one file is unservable, engine picks one).
// `api/ticks.v` below: `@[sse] ... []string`, harness streams each
// per-event; client consumes with the identical `for await` shape.

// Binary probe: serves bytes with Content-Type passthrough.
@[get('pdf')]
pub fn serve_pdf(req SwelteRequest) SwelteResponse {
	_ = req
	data := 'PDF-fixture'.bytes()
	mut res := swelte_bytes(data, 'application/pdf')
	res.headers['Content-Disposition'] = 'attachment; filename="doc.pdf"'
	return res
}

// Status sugar probe: (int, string) -> status+text.
@[get('created')]
pub fn make_created(req SwelteRequest) (int, string) {
	_ = req
	return 201, 'created'
}

// Pure rpc: protocol-ignorant typed call (works in #routes/ fetch AND #lib/ WASM).
// No HTTP types allowed (no SwelteRequest/SwelteResponse/[]u8/(int,string)) — throw → TS reject.
@[rpc]
pub fn greet_pure(args LoginArgs) !Session {
	if args.payload == '' {
		return error('missing payload')
	}
	return Session{ id: 'pure_' + args.payload, user: args.payload, remember: false, expires_at: time.now() }
}
