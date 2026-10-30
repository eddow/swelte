// Swelte API route `/api/greet`. V struct -> TS interface projection.
module greet

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

@[rpc]
@[sets_cookie]
pub fn login(args LoginArgs) !Session {
	if args.payload == '' {
		return error('missing payload')
	}
	return Session{
		id: 'sess_' + args.payload
		user: args.payload
		remember: true
		expires_at: time.now()
	}
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

// SSE probe (roadmap §14, emit mode): GET + Accept: text/event-stream
// takes over the conn; each `emit` flushes one frame immediately —
// sleeps pace the frames (real incremental flush, nothing buffered).
// Plain JSON GETs keep hitting `get_greeting` above.
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
