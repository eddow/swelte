module main

import net
import crypto.sha256
import net.http
import net.http.mime
import net.urllib
import json
import x.json2
import os
import routes
import strconv
import sync
import time
import veb
import veb.sse

#include "@SWELTE_HARNESS_DIR@/swelte_shutdown.h"
fn C.swelte_install_stop_signals() int
fn C.swelte_received_stop() int
fn C.swelte_atomic_replace(&char, &char) int

@[heap]
struct SwelteLifecycle {
mut:
	mu sync.Mutex
	stopping bool
	active int
	watching bool
	deadline i64
	control_mu sync.Mutex
	control &net.TcpConn = unsafe { nil }
	connections map[int]&net.TcpConn
	instance string = time.now().unix_nano().str()
	isr_busy map[string]bool
	sequence u64
	stop chan bool = chan bool{}
	finished chan bool = chan bool{cap: 1}
}

fn (mut state SwelteLifecycle) begin() bool {
	state.mu.lock()
	defer { state.mu.unlock() }
	if state.stopping { return false }
	state.active++
	return true
}

fn (mut state SwelteLifecycle) end() {
	state.mu.lock()
	state.active--
	state.mu.unlock()
}

fn (mut state SwelteLifecycle) count() int {
	state.mu.lock()
	defer { state.mu.unlock() }
	return state.active
}

fn (mut state SwelteLifecycle) is_stopping() bool {
	state.mu.lock()
	defer { state.mu.unlock() }
	return state.stopping
}

fn (mut state SwelteLifecycle) request_id() string {
	state.mu.lock()
	defer { state.mu.unlock() }
	state.sequence++
	return state.instance + '-' + state.sequence.str()
}

pub struct SwelteReport {
pub:
	phase string
	request_id string
	method string
	path string
	status int
	duration_ms i64
	message string
}

fn swelte_report(event SwelteReport) {
	_ = event
	// [swelte] report-hook
}

fn swelte_request_report(ctx &Ctx, phase string, status int, message string) {
	elapsed := time.now().unix_milli() - ctx.request_started
	swelte_report(SwelteReport{phase, ctx.request_id, ctx.req.method.str().to_upper(), ctx.req.url.all_before('?'), status, if elapsed < 0 { i64(0) } else { elapsed }, message})
}

fn swelte_stream_report(req routes.SwelteRequest, message string) {
	swelte_report(SwelteReport{phase: 'stream-error', request_id: req.headers['x-swelte-request-id'] or { '' }, method: req.method, path: req.path, status: 500, message: message})
}

// Every trigger enters this one idempotent lifecycle operation.
fn (mut state SwelteLifecycle) request_stop() {
	state.mu.lock()
	if state.stopping { state.mu.unlock(); return }
	state.stopping = true
	state.deadline = time.now().unix_milli() + swelte_env_int('SWELTE_SHUTDOWN_TIMEOUT_MS', 10000)
	state.stop.close()
	for handle, _ in state.connections { net.shutdown(handle) }
	state.mu.unlock()
	state.control_emit('stopping')
}

struct SwelteDevCommand {
	kind string @[json: 'type']
}

fn swelte_control_line(mut conn net.TcpConn) !string {
	mut line := []u8{cap: 128}
	mut byte := [u8(0)]
	for line.len < 4096 {
		if conn.read(mut byte)! == 0 { return error('controller disconnected') }
		if byte[0] == `\n` { return line.bytestr() }
		line << byte[0]
	}
	return error('control message too long')
}

fn swelte_control_write(mut conn net.TcpConn, message string) ! {
	bytes := message.bytes()
	mut offset := 0
	for offset < bytes.len {
		n := conn.write(bytes[offset..])!
		if n <= 0 { return error('controller disconnected') }
		offset += n
	}
}

fn (mut state SwelteLifecycle) control_emit(kind string) {
	if isnil(state.control) { return }
	state.control_mu.lock()
	defer { state.control_mu.unlock() }
	swelte_control_write(mut state.control, '{"type":"${kind}"}\n') or {}
}

fn swelte_open_dev_control(mut state SwelteLifecycle) ! {
	endpoint := os.getenv('SWELTE_DEV_CONTROL')
	if endpoint == '' { return }
	token := os.getenv('SWELTE_DEV_TOKEN')
	generation := os.getenv('SWELTE_DEV_GENERATION').int()
	if !endpoint.starts_with('127.0.0.1:') || token.len != 64 || generation <= 0 {
		return error('invalid dev controller configuration')
	}
	mut conn := net.dial_tcp(endpoint)!
	conn.set_read_timeout(5 * time.second)
	conn.set_write_timeout(time.second)
	swelte_control_write(mut conn, '{"type":"hello","version":1,"token":"${token}","generation":${generation},"pid":${os.getpid()}}\n')!
	accepted := json.decode(SwelteDevCommand, swelte_control_line(mut conn)!)!
	if accepted.kind != 'accepted' { return error('dev controller rejected handshake') }
	conn.set_read_timeout(net.infinite_timeout)
	state.control = conn
	// Child application workers must not inherit the parent's private credentials.
	os.unsetenv('SWELTE_DEV_CONTROL')
	os.unsetenv('SWELTE_DEV_TOKEN')
	os.unsetenv('SWELTE_DEV_GENERATION')
	spawn swelte_dev_control_watch(state)
}

fn swelte_dev_control_watch(lifecycle &SwelteLifecycle) {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	for {
		line := swelte_control_line(mut state.control) or { break }
		command := json.decode(SwelteDevCommand, line) or { break }
		if command.kind == 'stop' { break }
		// Unknown commands close the session and stop this owned application.
		break
	}
	state.request_stop()
	// Also bound a startup hook that never returns after controller loss.
	remaining := state.deadline - time.now().unix_milli()
	if remaining > 0 { time.sleep(remaining * time.millisecond) }
	eprintln('[swelte:shutdown] status=timeout phase=control')
	exit(1)
}

fn (mut state SwelteLifecycle) track(conn &net.TcpConn) bool {
	state.mu.lock()
	defer { state.mu.unlock() }
	if state.stopping { return false }
	state.connections[conn.sock.handle] = conn
	return true
}

fn (mut state SwelteLifecycle) close_conn(mut conn net.TcpConn) {
	state.mu.lock()
	defer { state.mu.unlock() }
	state.connections.delete(conn.sock.handle)
	conn.close() or {}
}

fn swelte_wait_active(ms i64, state &SwelteLifecycle) bool {
	select {
		_ := <-state.stop { return false }
		ms * time.millisecond { return true }
	}
	return false
}

pub fn (mut app App) init_server(server &veb.Server) {
	app.lifecycle.watching = true
	spawn swelte_shutdown_watch(server, app.lifecycle)
}

fn swelte_shutdown_watch(server &veb.Server, lifecycle &SwelteLifecycle) {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	server.wait_till_running() or { state.finished <- false; return }
	if !state.is_stopping() { state.control_emit('ready') }
	for C.swelte_received_stop() == 0 {
		if !swelte_wait_active(25, state) { break }
	}
	state.request_stop()
	deadline := state.deadline
	budget := deadline - time.now().unix_milli()
	if budget <= 0 { exit(1) }
	eprintln('[swelte:shutdown] status=draining')
	server.shutdown(timeout: budget * time.millisecond) or {
		eprintln('[swelte:shutdown] status=timeout phase=http')
		exit(1)
	}
	for state.count() > 0 {
		if time.now().unix_milli() >= deadline {
			eprintln('[swelte:shutdown] status=timeout phase=work')
			exit(1)
		}
		time.sleep(10 * time.millisecond)
	}
	state.finished <- true
}

fn swelte_app_shutdown() ! {
	// [swelte] shutdown-hook
}

fn swelte_run_shutdown(ch chan bool) {
	swelte_app_shutdown() or { swelte_report(SwelteReport{phase: 'shutdown-error', status: 500, message: err.msg()}); eprintln('[swelte:shutdown] status=error phase=hook'); ch <- false; return }
	ch <- true
}

struct SwelteSubscription {
	room string
	id int
}

@[heap]
struct SwelteSubscriptions {
mut:
	mu sync.Mutex
	closed bool
	entries []SwelteSubscription
}

// [swelte] room-subscribe-start
fn swelte_room_subscribe(room string, registry &SwelteSubscriptions) chan string {
	mut subs := unsafe { &SwelteSubscriptions(registry) }
	ch := chan string{cap: 1}
	subs.mu.lock()
	defer { subs.mu.unlock() }
	if subs.closed { ch.close(); return ch }
	// [swelte] room-subscribe
	return ch
}
// [swelte] room-subscribe-end

fn swelte_room_release(registry &SwelteSubscriptions) {
	mut subs := unsafe { &SwelteSubscriptions(registry) }
	subs.mu.lock()
	defer { subs.mu.unlock() }
	if subs.closed { return }
	subs.closed = true
	// [swelte] room-release
	subs.entries.clear()
}

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

// Public ISR policy: `SWELTE_ISR` = `prefix=seconds,...` (build-time
// env from the `isr` config). Longest prefix wins; 0 = no match.
fn swelte_isr_seconds(path string) int {
	mut raw := os.getenv('SWELTE_ISR')
	if raw == '' {
		dist := os.getenv('SWELTE_DIST')
		settings_json := os.read_file(dist + '/isr.json') or { '{}' }
		settings := json.decode(map[string]int, settings_json) or { map[string]int{} }
		raw = settings.keys().map(it + '=' + settings[it].str()).join(',')
	}
	if raw == '' {
		return 0
	}
	mut best := 0
	mut best_len := -1
	for part in raw.split(',') {
		eq := part.index('=') or { continue }
		prefix := part[..eq].trim_space()
		seconds := part[eq + 1..].trim_space().int()
		if prefix == '' || seconds <= 0 {
			continue
		}
		p := if prefix == '/' { '/' } else { '/' + prefix.trim('/ \t') }
		hit := if p == '/' { true } else { path == p || path.starts_with(p + '/') }
		if hit && p.len > best_len {
			best_len = p.len
			best = seconds
		}
	}
	return best
}

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

// §11 rate-limit state lives on the veb App: before_request runs on the
// App receiver, so per-request calls share the map under a mutex. No
// `__global` (needs `-enable-globals`); single-instance in-memory only.
pub struct Ctx {
	veb.Context
mut:
	lifecycle &SwelteLifecycle = unsafe { nil }
	request_id string
	request_started i64
}

pub struct App {
mut:
	lifecycle &SwelteLifecycle = &SwelteLifecycle{}
	buckets map[string]SwelteBucket
	mu      sync.Mutex
}

fn (mut app App) swelte_rate_limited(ip string) bool {
	limit := swelte_rate_limit()
	window := swelte_rate_window_ms()
	now := time.now().unix_milli()
	app.mu.lock()
	defer {
		app.mu.unlock()
	}
	// Opportunistic eviction: drop buckets idle for 2 windows so the map
	// cannot grow without bound (memory-DoS vector). Linear scan under
	// the mutex — fine at dev/prod-single-instance scale.
	for k, v in app.buckets {
		if now - v.window_start >= 2 * window {
			app.buckets.delete(k)
		}
	}
	mut b := app.buckets[ip] or { SwelteBucket{window_start: now} }
	if now - b.window_start >= window {
		b.window_start = now
		b.count = 0
	}
	b.count += 1
	app.buckets[ip] = b
	return b.count > limit
}

// Route-call inputs cross the spawn boundary for the timeout watchdog.
struct SwelteRouteCall {
	path         string
	method       string
	query        map[string]string
	headers      map[string]string
	cookies      map[string]string
	locals       map[string]string
	body         string
	content_type string
	qualifier    string
}

struct SwelteRouteOut {
	mut:
		res routes.SwelteResponse
}

fn swelte_route_spawned(c SwelteRouteCall, ch chan SwelteRouteOut, lifecycle &SwelteLifecycle) {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	defer { state.end() }
	res := routes.swelte_route(c.path, c.method, c.query,
		c.headers, c.cookies, c.locals, c.body, c.content_type, c.qualifier)
	ch <- SwelteRouteOut{ res: res }
}

fn swelte_call_route_timeout(path string, method string, query map[string]string, headers map[string]string, cookies map[string]string, locals map[string]string, body string, content_type string, qualifier string, budget_ms i64, lifecycle &SwelteLifecycle) SwelteRouteOut {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	if !state.begin() { return SwelteRouteOut{res: routes.SwelteResponse{status: 503}} }
	budget := if budget_ms > 0 { budget_ms } else { swelte_handler_timeout_ms() }
	ch := chan SwelteRouteOut{cap: 1}
	call := SwelteRouteCall{path, method, query, headers, cookies, locals, body, content_type,
		qualifier}
	spawn swelte_route_spawned(call, ch, state)
	select {
		out := <-ch {
			return out
		}
		budget * time.millisecond {
			return SwelteRouteOut{ res: routes.SwelteResponse{ status: 500, headers: {'Content-Type': 'application/json'}, body: '{"error":"handler timeout"}' } }
		}
	}
	// Unreachable: select always returns via the channel or the timeout.
	return SwelteRouteOut{ res: routes.SwelteResponse{ status: 500, headers: {'Content-Type': 'application/json'}, body: '{"error":"handler timeout"}' } }
}

fn swelte_html_escape(s string) string {
	mut out := s
	out = out.replace('&', '&amp;')
	out = out.replace('<', '&lt;')
	out = out.replace('>', '&gt;')
	out = out.replace('"', '&quot;')
	return out
}

// @[error] default (SvelteKit `handleError` lite): sanitize the throw
// message before it reaches the client (+error props / JSON). The
// generate() hook replaces this whole fn with the user's
// `@[error] (message string, status int) string` body when src/app.v
// defines one. Return '' to keep the message, else the replacement.
fn swelte_sanitize_error(message string, status int) string {
	if status >= 500 { return 'internal server error' }
	return message
}

// P2 serializedHeaders-lite (SvelteKit `filterSerializedResponseHeaders`
// lite): longest-prefix match over `routes.swelte_serialized_headers()`
// via the generated `routes.swelte_route_hit()` predicate (static rows =
// exact-or-prefix, dynamic rows = `swelte_match_route`). Returns
// `found` = the route names a list at all (incl. `[]` = keep nothing)
// plus the names; absent = no filter (today's behavior preserved). One
// table scan per request.
fn swelte_serialized_lookup(path string) (bool, []string) {
	mut best := -1
	mut found := false
	mut names := []string{}
	for row in routes.swelte_serialized_headers() {
		r := row.route
		if routes.swelte_route_hit(r, path) && r.len > best {
			best = r.len
			found = true
			names = row.names.clone()
		}
	}
	return found, names
}

// Per-route limits lookup (P1 item 12 lite): longest-prefix match over
// `routes.swelte_route_limits()`; 0 fields = no override (fall through
// to the global env knob). Pure + fast — runs before the rate/body gates.
// Same `swelte_route_hit` predicate as serializedHeaders, so dynamic
// rows (`/users/[id]`) override for their concrete paths too.
fn swelte_limits_for(path string) routes.SwelteRouteLimits {
	mut best := routes.SwelteRouteLimits{}
	mut best_len := -1
	for lim in routes.swelte_route_limits() {
		r := lim.route
		if routes.swelte_route_hit(r, path) && r.len > best_len {
			best = lim
			best_len = r.len
		}
	}
	return best
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

// Fill the SSR placeholders in an HTML shell: <!--ssr-head--> → head,
// <!--ssr-body--> + data-swelte-ssr marker on the #app host. When the
// shell has no placeholders (custom index.html), return it unchanged —
// the client entry hydrates when #app has children regardless.
fn swelte_fill_ssr(shell string, head string, body string) string {
	if !shell.contains('<!--ssr-body-->') && !shell.contains('<!--ssr-head-->') {
		return shell
	}
	mut out := shell
	if head != '' {
		out = out.replace('<!--ssr-head-->', head)
	} else {
		out = out.replace('<!--ssr-head-->', '')
	}
	out = out.replace('<!--ssr-body-->', body)
	// Mark the host for hydrate-first main.ts (id + data attr).
	out = out.replace('<div id="app">', '<div id="app" data-swelte-ssr="1">')
	return out
}

// Serve order (SPA-first proxy rule, unchanged): exact `dist/` file wins
// (incl. additive prerendered `dist/<route>/index.html` — a real file, so
// `serve_static` returns it before the SPA fallback below; `/` keeps the
// shell because `runPrerender` never overwrites `dist/index.html`).
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
	// serve_static is the SPA-shell source: missing files fall back to
	// dist/index.html (200). API-ish callers (JSON/EventSource probes)
	// must never receive the shell — see the no-ssr bypass below.
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

fn (mut app App) before_request(mut ctx Ctx) veb.Result {
	ctx.lifecycle = app.lifecycle
	if !app.lifecycle.begin() {
		ctx.res.set_status(.service_unavailable)
		return ctx.send_response_to_client('application/json', '{"error":"server stopping"}')
	}
	defer { app.lifecycle.end() }
	ctx.request_started = time.now().unix_milli()
	ctx.request_id = app.lifecycle.request_id()
	ctx.res.header.set_custom('X-Swelte-Request-Id', ctx.request_id) or {}
	defer { swelte_request_report(&ctx, 'request', ctx.res.status_code, '') }
	mut path := if ctx.req.url.contains('?') { ctx.req.url.all_before('?') } else { ctx.req.url }
	// @[reroute] (src/app.v) may reassign path below — mutable by design.
	// Roadmap §1.3 `trailingSlash` (+ §1.6 CSRF + §1.6 `_method`): env wins,
	// like the §11 knobs. `ignore` = today's behavior (no redirect, exact match).
	trailing_mode := os.getenv_opt('SWELTE_TRAILING_SLASH') or { '' }
	if trailing_mode == 'always' && path != '/' && !path.ends_with('/') {
		ctx.res.header.set_custom('Location', path + '/') or {}
		ctx.res.set_status(.moved_permanently)
		return ctx.send_response_to_client('text/plain', '')
	}
	if trailing_mode == 'never' && path.len > 1 && path.ends_with('/') {
		ctx.res.header.set_custom('Location', path[..path.len - 1]) or {}
		ctx.res.set_status(.moved_permanently)
		return ctx.send_response_to_client('text/plain', '')
	}
	// CSRF origin check (SvelteKit `csrf.checkOrigin` equivalent): when
	// SWELTE_CSRF_CHECK_ORIGIN=1, cross-origin mutating requests without a
	// matching Origin are rejected — same JSON envelope as §11.
	if (os.getenv_opt('SWELTE_CSRF_CHECK_ORIGIN') or { '' }) == '1' {
		m := ctx.req.method
		if m == .post || m == .put || m == .patch || m == .delete {
			origin := ctx.req.header.get_custom('Origin') or { '' }
			host := ctx.req.header.get_custom('Host') or { ctx.req.header.get(.host) or { '' } }
			if origin != '' && host != '' && !origin.contains(host) {
				ctx.res.set_status(.forbidden)
				return ctx.send_response_to_client('application/json', '{"error":"forbidden"}')
			}
		}
	}
	cors_origin := os.getenv_opt('SWELTE_CORS_ORIGIN') or { '' }
	origin := ctx.req.header.get_custom('Origin') or { '' }
	cors_ok := cors_origin != '' && (cors_origin == '*' || cors_origin == origin)
	set_cors := fn (mut ctx Ctx, cors_ok bool, cors_origin string, origin string) {
		if cors_ok {
			ctx.set_header(.access_control_allow_origin, if cors_origin == '*' { '*' } else { origin })
			ctx.res.header.set_custom('Access-Control-Allow-Credentials', 'true') or {}
		}
	}
	if ctx.req.method == .options {
		if cors_ok {
			ctx.set_header(.access_control_allow_origin, if cors_origin == '*' { '*' } else { origin })
			ctx.res.header.set_custom('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS') or {}
			ctx.res.header.set_custom('Access-Control-Allow-Headers', 'Content-Type, Accept') or {}
			ctx.res.header.set_custom('Access-Control-Max-Age', '86400') or {}
		}
		ctx.res.set_status(.no_content)
		return ctx.send_response_to_client('text/plain', '')
	}
	// Item 9: version stamp — X-Swelte-Version when SWELTE_VERSION is set
	// (baked from package.json by generate(); env wins like the §11 knobs).
	if v := os.getenv_opt('SWELTE_VERSION') {
		ctx.res.header.set_custom('X-Swelte-Version', v) or {}
	}
	mut query := map[string]string{}
	if ctx.req.url.contains('?') {
		for part in ctx.req.url.all_after('?').split('&') {
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
	for k in ctx.req.header.keys() {
		if v := ctx.req.header.get_custom(k) {
			headers[k] = v
		}
	}
	headers['x-swelte-request-id'] = ctx.request_id
	headers['X-Swelte-Request-Id'] = ctx.request_id
	mut cookies := map[string]string{}
	if c := ctx.req.header.get(.cookie) {
		for part in c.split(';') {
			kv := part.split('=')
			if kv.len == 2 {
				cookies[kv[0].trim_space()] = kv[1].trim_space()
			}
		}
	}
	content_type := ctx.req.header.get(.content_type) or { '' }
	// §11 Hardening: client IP comes from veb's parsed peer address
	// (never X-Forwarded-For, which is client-controlled and spoofable).
	// Per-route limits (longest-prefix over the `swelte_route_limits()`
	// table) override the global env knobs where set (0 = no override).
	ip := ctx.ip()
	lim := swelte_limits_for(path)
	rate_limit := if lim.rate > 0 { lim.rate } else { swelte_rate_limit() }
	rate_window := if lim.rate_window_ms > 0 { i64(lim.rate_window_ms) } else { swelte_rate_window_ms() }
	body_limit := if lim.body_limit > 0 { lim.body_limit } else { swelte_body_limit() }
	handler_ms := if lim.timeout_ms > 0 { i64(lim.timeout_ms) } else { swelte_handler_timeout_ms() }
	mut bucket_hit := false
	{
		limit := rate_limit
		window := rate_window
		now := time.now().unix_milli()
		app.mu.lock()
		for k, v in app.buckets {
			if now - v.window_start >= 2 * window {
				app.buckets.delete(k)
			}
		}
		mut b := app.buckets[ip] or { SwelteBucket{window_start: now} }
		if now - b.window_start >= window {
			b.window_start = now
			b.count = 0
		}
		b.count += 1
		app.buckets[ip] = b
		bucket_hit = b.count > limit
		app.mu.unlock()
	}
	if bucket_hit {
		ctx.res.set_status(.too_many_requests)
		return ctx.send_response_to_client('application/json', '{"error":"rate limited"}')
	}
	// §11 Hardening: body cap before routing (multipart included —
	// uploads in §13 live under the same knob).
	if ctx.req.data.len > body_limit {
		ctx.res.set_status(.request_entity_too_large)
		return ctx.send_response_to_client('application/json', '{"error":"body too large"}')
	}
	mut qualifier := query['q'] or { '' }
	if routes.swelte_named_actions() {
		qualifier = ''
		mut count := 0
		raw_query := if ctx.req.url.contains('?') { ctx.req.url.all_after('?') } else { '' }
		for raw in raw_query.split('&') {
			key := urllib.query_unescape(raw.all_before('=')) or { '' }
			if !key.starts_with('/') { continue }
			count++
			if key.len < 2 || (raw.contains('=') && raw.all_after('=') != '') || count > 1 {
				ctx.res.set_status(.bad_request)
				return ctx.send_response_to_client('application/json', '{"error":"ambiguous or empty named action"}')
			}
			qualifier = key[1..]
		}
	} else if qualifier == '' {
		for k, v in query {
			// First bare key (`?delete`, value == '') doubles as qualifier.
			// Real args (`?payload=x`) have values and are skipped.
			// `_method` is consumed below (not a qualifier).
			if k == '_method' {
				continue
			}
			if v == '' {
				qualifier = k
				break
			}
		}
	}
	// Method override (SvelteKit `methodOverride` equivalent): when
	// SWELTE_METHOD_OVERRIDE=1, `?_method=DELETE` on a POST re-dispatches
	// as that verb. Body stays form-encoded; only the dispatch verb changes.
	mut dispatch_method := ctx.req.method.str().to_upper()
	if (os.getenv_opt('SWELTE_METHOD_OVERRIDE') or { '' }) == '1' {
		override := query['_method'] or { '' }
		if dispatch_method == 'POST' && override != '' {
			upper := override.to_upper()
			if upper == 'PUT' || upper == 'PATCH' || upper == 'DELETE' {
				dispatch_method = upper
			}
		}
	}
	// §WS (future.md #3): WebSocket upgrade. before_request owns `ctx`, so
	// Reject cross-origin writes before any handler can perform side effects.
	if !cors_ok && origin != '' && ctx.req.method != .get && ctx.req.method != .head {
		host := ctx.req.header.get(.host) or { '' }
		parsed_origin := urllib.parse(origin) or {
			ctx.res.set_status(.forbidden)
			return ctx.send_response_to_client('application/json', '{"error":"forbidden"}')
		}
		if host != '' && parsed_origin.host != host {
			ctx.res.set_status(.forbidden)
			return ctx.send_response_to_client('application/json', '{"error":"forbidden"}')
		}
	}
	// WebSocket upgrade. before_request owns `ctx`, so
	// the Upgrade handshake is intercepted HERE — never reaches dispatch.
	// On a GET+Upgrade:websocket match on an `@[ws]` file: build the
	// SwelteRequest, take over the conn, 101 + frame pump. Non-upgrade
	// GETs on the same path fall through to dispatch (404/405 as usual).
	ws_prefix := routes.swelte_ws_route(path, dispatch_method, headers)
	if ws_prefix != '' {
		mut ws_req := routes.SwelteRequest{ query: query, form: map[string]string{}, files: map[string]string{}, files_bytes: map[string][]u8{}, raw_body: []u8{}, headers: headers, cookies: cookies, params: map[string]string{}, locals: map[string]string{}, method: 'GET', path: path, qualifier: '' }
		ws_req = swelte_stream_request(mut ctx, ws_prefix, ws_req) or {
			return swelte_send_envelope(mut ctx, routes.swelte_error_response(ws_req, err))
		}
		return swelte_serve_ws(mut ctx, ws_prefix, ws_req)
	}
	// §14 SSE (true streaming, veb): before_request owns `ctx`, so SSE
	// intent is intercepted HERE — never reaches dispatch. On a
	// GET+Accept match on an SSE route: build the SwelteRequest,
	// resolve events via the generated accessor, take over + stream.
	sse_prefix, sse_params := routes.swelte_sse_route(path, dispatch_method, query, headers, qualifier)
	if sse_prefix != '' {
		mut sse_req := routes.SwelteRequest{ query: query, form: map[string]string{}, files: map[string]string{}, files_bytes: map[string][]u8{}, raw_body: []u8{}, headers: headers, cookies: cookies, params: sse_params, locals: map[string]string{}, method: 'GET', path: path, qualifier: qualifier }
		sse_req = swelte_stream_request(mut ctx, sse_prefix, sse_req) or {
			return swelte_send_envelope(mut ctx, routes.swelte_error_response(sse_req, err))
		}
		if cors_ok {
			ctx.set_header(.access_control_allow_origin, if cors_origin == '*' { '*' } else { origin })
			ctx.res.header.set_custom('Access-Control-Allow-Credentials', 'true') or {}
		}
		mut events := []string{}
		if !routes.swelte_sse_is_emit(sse_prefix) {
			events = routes.swelte_sse_events_for(sse_prefix, qualifier, sse_req) or {
				return swelte_send_envelope(mut ctx, routes.swelte_error_response(sse_req, err))
			}
		} else {
			// Emit-mode fns run inside the writer (post-takeover), so an
			// unknown qualifier would strand the client on a bare stream.
			// Pre-flight ONLY the qualifier here (side-effect free — the
			// fn itself runs once, inside the writer).
			routes.swelte_sse_check_qual(sse_prefix, qualifier) or {
				ctx.res.set_status(.bad_request)
				return ctx.send_response_to_client('application/json', '{"error":"' + err.msg() + '"}')
			}
		}
		return swelte_serve_sse(mut ctx, sse_prefix, qualifier, sse_req, events)
	}
	page_accept := headers['Accept'] or { headers['accept'] or { '' } }
	page_load := (headers['X-Swelte-Load'] or { headers['x-swelte-load'] or { '' } }) == '1'
	page_prefix, _ := routes.swelte_load_route(path)
	// Neutral agents (no Accept, `*/*`, or text/* without an explicit
	// JSON/SDK/fetch signal) are navigations on page routes: browsers
	// send `text/html`, but crawlers/AI readers send `*/*` or nothing —
	// those must also get SSR HTML, not the verb-dispatch JSON probe
	// (which made agents see only the page title + `"Swelte docs"`).
	// Explicit JSON stays JSON: `application/json` Accept, `?q`/`?payload`
	// probes, XHR `X-Requested-With`, the SDK load fetch, non-GET.
	page_is_neutral := page_accept == '' || page_accept == '*/*' || (!page_accept.contains('application/json') && !page_accept.contains('json') && !page_accept.contains('text/event-stream') && (page_accept.contains('text/html') || page_accept.contains('text/') || page_accept.contains('*')))
	page_is_fetch := page_load || (headers['X-Requested-With'] or { headers['x-requested-with'] or { '' } }) != '' || (headers['X-Swelte-Fetch'] or { headers['x-swelte-fetch'] or { '' } }) != ''
	page_get_probe := ctx.req.url.contains('?q=') || ctx.req.url.contains('?payload=') || ctx.req.url.contains('&q=') || ctx.req.url.contains('&payload=')
	page_wants_json := page_accept.contains('application/json') || page_accept.contains('+json')
	page_is_nav := ctx.req.method == .get && page_prefix != '' && !page_is_fetch && !page_get_probe && !page_wants_json && (page_accept.contains('text/html') || page_is_neutral)
	// ISR is public and canonical: personalized/query/data requests bypass it.
	if ctx.req.method == .get && page_prefix != '' && page_accept.contains('text/html') && !page_accept.contains('application/json') && !page_load && !ctx.req.url.contains('?') && cookies.len == 0 && (headers['Authorization'] or { headers['authorization'] or { '' } }) == '' && (headers['X-Swelte-Isr'] or { headers['x-swelte-isr'] or { '' } }) != app.lifecycle.instance {
		seconds := swelte_isr_seconds(path)
		dist := os.getenv('SWELTE_DIST')
		if seconds > 0 && dist != '' && swelte_ssr_enabled() && !routes.swelte_no_ssr(path) {
			host := headers['Host'] or { headers['host'] or { 'localhost' } }
			key := sha256.hexhash(host + path + swelte_shell_for(dist, path))
			file := dist + '/.swelte-isr/' + key + '.html'
			if html := os.read_file(file) {
				age := time.now().unix() - os.file_last_mod_unix(file)
				if age >= seconds { swelte_isr_schedule(app.lifecycle, path, host, file) }
				ctx.res.header.set_custom('Cache-Control', 'public, max-age=0, s-maxage=' + seconds.str() + ', stale-while-revalidate=' + seconds.str()) or {}
				ctx.res.header.set_custom('Age', age.str()) or {}
				ctx.res.header.set_custom('X-Swelte-Cache', if age >= seconds { 'STALE' } else { 'HIT' }) or {}
				ctx.res.set_status(.ok)
				return ctx.send_response_to_client('text/html; charset=utf-8', html)
			}
			swelte_isr_schedule(app.lifecycle, path, host, file)
		}
	}
	if page_is_nav {
		return swelte_serve_page(mut ctx, path, query, headers, cookies, page_load)
	}
	// (swelte_call_route is sync — veb runs before_request on a worker;
	// the `spawn select` watchdog keeps the server responsive).
	out := swelte_call_route_timeout(path, dispatch_method, query, headers, cookies, map[string]string{}, ctx.req.data, content_type, qualifier, handler_ms, ctx.lifecycle)
	status := out.res.status
	mut body := out.res.body
	if status >= 400 {
		fields := json2.decode[map[string]json2.Any](body) or { map[string]json2.Any{} }
		message := (fields['message'] or { fields['error'] or { json2.Any('handler failed') } }).str()
		swelte_request_report(&ctx, 'handler-error', status, message)
	}
	set_cookies := out.res.cookies
	// Same-origin mutating requests always pass (browser sends Origin on
	// same-origin POST/fetch). Only cross-origin writes need cors_ok —
	// otherwise every default same-origin POST 403s when SWELTE_CORS_ORIGIN
	// is unset. Mirrors the CSRF host check above.
	dist := os.getenv_opt('SWELTE_DIST') or { '' }
	// Cache metadata for non-page/static paths: stamp early — before the SSR/static/shell early
	// returns below — so every GET HTML 200 serve path carries the headers,
	// not just the API-envelope path at the bottom. `set_custom`
	// accumulates; later `send_response_to_client` calls flush all headers
	// set so far. Page caching/regeneration happens above.
	// (`wants_html`/`wants_json` are declared further down; the Accept test
	// is inlined here so the stamp stays above the early returns.)
	if ctx.req.method == .get && status == 200 {
		isr_accept := headers['Accept'] or { headers['accept'] or { '' } }
		if isr_accept.contains('text/html') && !isr_accept.contains('application/json') {
			seconds := swelte_isr_seconds(path)
			if seconds > 0 {
				ctx.res.header.set_custom('Cache-Control', 'public, max-age=0, s-maxage=' + seconds.str()) or {}
				ctx.res.header.set_custom('X-Swelte-Revalidate', seconds.str()) or {}
			}
		}
	}
	// Static-first for exact dist files (sw.js, hashed assets): serve the
	// file regardless of Accept. The SPA-first proxy rule is about ROUTES
	// (page navigations vs API dispatch) — real files always win so the SW
	// registration fetch and precache never see dispatcher 404/shell HTML.
	if dist != '' && ctx.req.method == .get && (status < 400 || body.contains('not found')) {
		full := dist + path
		if !path.contains('..') && os.exists(full) && !os.is_dir(full) {
			data := os.read_bytes(full) or { return ctx.send_response_to_client('application/json', '{"error":"read failed"}') }
			fname := if path.contains('/') { path.all_after_last('/') } else { path }
			ext := if fname.contains('.') { fname.all_after_last('.').to_lower() } else { '' }
			ct := if ext == 'js' { 'application/javascript' } else { mime_for(path) }
			ctx.res.set_status(http.status_from_int(200))
			return ctx.send_response_to_client(ct, data.bytestr())
		}
	}
	// SSR first (when enabled + HTML navigation): render → fill shell.
	// On render miss/failure, fall through to no-JS/static/SPA below.
	// (Static used to win here — SSR never ran when dist/ existed.)
	// NOTE: `wants_html` covers real browsers AND neutral agents
	// (no Accept / `*/*` / text/* on a page route — see `page_is_nav`
	// above): those are navigations, not API probes, and enter the SSR
	// chain. Explicit `application/json` stays JSON. This preserves §12
	// no-JS form redirects (browser navigations, POST branch above).
	mut cookies_out := set_cookies.clone()
	// §12 No-JS forms: browser navigations (Accept: text/html, no JSON)
	// get a redirect on success / server-rendered error page on failure
	// instead of JSON. Fetch stubs (Accept: application/json) keep JSON.
	// Neutral agents join the navigation path (see note above) — probes
	// keep JSON only when they explicitly ask for it.
	accept := headers['Accept'] or { headers['accept'] or { '' } }
	wants_html := (accept.contains('text/html') || page_is_nav) && !accept.contains('application/json')
	wants_json := (headers['Accept'] or { headers['accept'] or { '' } }).contains('application/json')
	for c in cookies_out {
		ctx.res.header.add(.set_cookie, c.to_header())
	}
	set_cors(mut ctx, cors_ok, cors_origin, origin)
	if out.res.stream != unsafe { nil } {
		return swelte_serve_stream(mut ctx, out.res, path)
	}
	if wants_html && ctx.req.method != .get {
		for k, v in out.res.headers { ctx.res.header.set_custom(k, v) or {} }
		if status >= 300 && status < 400 { return swelte_send_envelope(mut ctx, routes.SwelteResponse{status: status, headers: out.res.headers}) }
		if status >= 200 && status < 300 {
			mut kept := []string{}
			if ctx.req.url.contains('?') {
				for part in ctx.req.url.all_after('?').split('&') {
					key := urllib.query_unescape(part.all_before('=')) or { '' }
					if (routes.swelte_named_actions() && key.starts_with('/')) || (!routes.swelte_named_actions() && (key == 'q' || key == qualifier)) { continue }
					kept << part
				}
			}
			return ctx.redirect(path + if kept.len > 0 { '?' + kept.join('&') } else { '' }, typ: .see_other)
		}
		prefix, _ := routes.swelte_load_route(path)
		if prefix != '' {
			mut form_body := body
			if !body.starts_with('{') { form_body = json.encode(body) }
			return swelte_serve_page_form(mut ctx, path, query, headers, cookies, false, form_body, status)
		}
	}
	// Load cascade → SSR props. On HTML navigations (never fetch), resolve
	// the page route, run ancestor +route `@[load]` fns root-first (leaf
	// merges parent + own data), and hand the resulting JSON to the SSR
	// renderer as props_json. `swelte_route()` stays the API dispatch
	// (unchanged); `swelte_load_for()` is the page-data path.
	// Any load throw → +error props with the mapped status.
	// No loads on the route → '{}' (static shell, hydrates, client fetches).
	// `accept.contains('text/html')` (in `wants_html`): only a real browser
	// Accept enters SSR. Bare curl (no Accept, or */*) keeps the old
	// JSON/static paths — including the §12 no-JS form redirect chain.
	// §4 ssr=false-lite: `export const ssr = false` routes skip the
	// QJS/sidecar entirely — Hand serves the SPA shell; async universal
	// loads + client router take over in the browser.
	if wants_html && !wants_json && swelte_ssr_enabled() && !routes.swelte_no_ssr(path) && (page_prefix != '' || status >= 400) {
		if status == 200 {
			load_res := swelte_page_props(path, query, headers, cookies, map[string]string{})
			props_json := load_res.body
			// P0 item 2: the load envelope lands on the HTML navigation —
			// Set-Cookie + custom headers + non-200 status (redirect/error
			// from the load). Plain loads are a 200 default envelope.
			// P2 serializedHeaders-lite: when the route names an allowlist
			// (`export const serializedHeaders = [...]` →
			// `swelte_serialized_headers()`), only those header names land
			// here (exact match, case-insensitive); absent = no filter.
			// `Location` always passes — a load-side 3xx redirect must not
			// lose its target when the allowlist omits it.
			filtered, allowed := swelte_serialized_lookup(path)
			for k, v in load_res.headers {
				lk := k.to_lower()
				if filtered && lk != 'location' {
					mut keep := false
					for a in allowed {
						if a.to_lower() == lk {
							keep = true
							break
						}
					}
					if !keep {
						continue
					}
				}
				ctx.res.header.set_custom(k, v) or { continue }
			}
			for c in load_res.cookies {
				ctx.res.header.add(.set_cookie, c.to_header())
			}
			if load_res.status != 200 {
				// P0 item 2, redirect half: a load-side 3xx + Location is not
				// an error — answer the redirect directly (Location already
				// set above, kept even when serializedHeaders omits it).
				if load_res.status >= 300 && load_res.status < 400 {
					loc := load_res.headers['Location'] or { load_res.headers['location'] or { '' } }
					if loc != '' {
						ctx.res.set_status(http.status_from_int(load_res.status))
						return ctx.send_response_to_client('text/html; charset=utf-8', '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=' + swelte_html_escape(loc) + '"></head><body><a href="' + swelte_html_escape(loc) + '">redirect</a></body></html>')
					}
				}
				mut err_json := '{"status":' + load_res.status.str() + ',"message":"error"}'
				// Thrown typed loads (swelte_load_err_typed) carry their
				// message in the envelope body — thread it into +error
				// props, sanitized before send (P1 item 7).
				lmsg_tmp := load_res.body.all_after('"message":')
				if lmsg_tmp != load_res.body {
					lmsg_q := lmsg_tmp.trim_space()
					if lmsg_q.starts_with('"') {
						err_json = '{"status":' + load_res.status.str() + ',"message":' + swelte_json_str(swelte_sanitize_error(lmsg_q[1..].all_before('"'), load_res.status)) + '}'
					}
				}
				joined_err, ok_err := swelte_render_page('/+error', err_json.trim_right('}') + ',"path":' + swelte_json_str(path) + '}')
				if ok_err {
					head := swelte_page_head_split(joined_err)
					html, _ := swelte_split_head_body(joined_err, true)
					ctx.res.set_status(http.status_from_int(load_res.status))
					return ctx.send_response_to_client(
						'text/html; charset=utf-8',
						swelte_fill_ssr(swelte_shell_for(dist, path), head, html)
					)
				}
				ctx.res.set_status(http.status_from_int(load_res.status))
				return ctx.send_response_to_client('text/html; charset=utf-8', props_json)
			}
			// Load-side redirect that reached the render-miss fallback (no
			// +error render, or 3xx without Location above): keep the
			// redirect contract (status + Location) instead of the shell.
			if load_res.status >= 300 && load_res.status < 400 {
				loc := load_res.headers['Location'] or { load_res.headers['location'] or { '' } }
				if loc != '' {
					ctx.res.set_status(http.status_from_int(load_res.status))
					return ctx.send_response_to_client('text/html; charset=utf-8', '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=' + swelte_html_escape(loc) + '"></head><body><a href="' + swelte_html_escape(loc) + '">redirect</a></body></html>')
				}
			}
			joined, ok := swelte_render_page(path, props_json)
			if ok {
				head := swelte_page_head_split(joined)
				html, _ := swelte_split_head_body(joined, true)
				ctx.res.set_status(http.status_from_int(status))
				return ctx.send_response_to_client(
					'text/html; charset=utf-8',
					swelte_fill_ssr(swelte_shell_for(dist, path), head, html)
				)
			}
		} else if status >= 400 && body.contains('not found') {
			// Unknown path → global +error 404 when SSR is on; without
			// +error.svelte the static/SPA fallback below still applies.
			// @[error] sanitizes the stock message too (P1 item 7).
			nf_msg := swelte_json_str(swelte_sanitize_error('not found', 404))
			joined, ok := swelte_render_page('/+error', '{"status":404,"message":' + nf_msg + ',"path":' + swelte_json_str(path) + '}')
			if ok {
				head := swelte_page_head_split(joined)
				html, _ := swelte_split_head_body(joined, true)
				ctx.res.set_status(http.status_from_int(404))
				return ctx.send_response_to_client(
					'text/html; charset=utf-8',
					swelte_fill_ssr(swelte_shell_for(dist, path), head, html)
				)
			}
		} else if status >= 400 {
			// Dispatch-throw errors (typed or plain): thread the message
			// into +error props with the status — sanitized before send
			// (P1 item 7), never the raw throw text.
			mut dmsg := 'error'
			dtmp := body.all_after('"error":"')
			if dtmp != body {
				dmsg = dtmp.all_before('"')
			}
			dmsg = swelte_sanitize_error(dmsg, status)
			joined, ok := swelte_render_page('/+error', '{"status":' + status.str() + ',"message":' + swelte_json_str(dmsg) + ',"path":' + swelte_json_str(path) + '}')
			if ok {
				head := swelte_page_head_split(joined)
				html, _ := swelte_split_head_body(joined, true)
				ctx.res.set_status(http.status_from_int(status))
				return ctx.send_response_to_client(
					'text/html; charset=utf-8',
					swelte_fill_ssr(swelte_shell_for(dist, path), head, html)
				)
			}
		}
	}
	// Static/SPA fallback (after SSR attempt above): dist/index.html for
	// / and unknown non-api paths, raw assets otherwise.
	// §4 ssr=false-lite: SSR was deliberately skipped above
	// (swelte_no_ssr) — still serve the SPA shell (200), not 404: the
	// async universal load + client router take over in the browser.
	// This bypass runs BEFORE the wants_html error page so no-ssr
	// routes never see the 404/error HTML — only the SPA shell.
	// Fetch stubs keep JSON (Accept: application/json or ?q probes):
	// only navigations (browser HTML or neutral agent Accept on a page
	// route, no JSON, no event-stream) get the shell.
	// SSE intent (bare `GET` + `Accept: text/event-stream`, no qualifier)
	// also skips the shell — the dispatcher/SSE takeover owns that shape.
	// Explicit JSON probes (`application/json`, SDK fetches) keep the
	// status/body contract — never the SPA shell.
	mut is_sse := accept.contains('text/event-stream')
	if routes.swelte_no_ssr(path) && ctx.req.method == .get && !wants_json && wants_html && !is_sse {
		_, ct, sb := serve_static(dist, '/index.html')
		ctx.res.set_status(http.status_from_int(200))
		return ctx.send_response_to_client(ct, sb)
	}
	if wants_html && status == 200 && ctx.req.method != .get {
		ctx.res.set_status(.see_other)
		return ctx.redirect(path, typ: .see_other)
	}
	if wants_html && status >= 400 {
		// no-ssr routes already returned above — this is a real error.
		// @[error]: sanitize before the message reaches the HTML shell.
		mut msg := body.all_after('"error":"')
		if msg != body {
			msg = msg.all_before('"')
		}
		msg = swelte_sanitize_error(msg, status)
		ctx.res.set_status(http.status_from_int(status))
		return ctx.send_response_to_client('text/html; charset=utf-8', '<!doctype html><html><body><main><p>' + swelte_html_escape(msg) + '</p><p><a href="' + path + '">back</a></p></main></body></html>')
	}
	// Static/SPA fallback (after SSR attempt above): dist/index.html for
	// / and unknown non-api paths, raw assets otherwise.
	// Fetch stubs (Accept: application/json) never get the shell — that
	// breaks __swelteFetch JSON decoding (gets HTML instead). The
	// `!wants_json` guard keeps RPC GETs (`/`, `/api/*`) on the dispatcher.
	if dist != '' && ctx.req.method == .get && !wants_json && !path.starts_with('/api/') && (path == '/' || (status == 404 && body.contains('not found'))) {
		// Explicit non-navigation probes (SSE intent, or neither HTML nor
		// neutral-agent Accept and no JSON — e.g. `curl -H 'Accept: image/*'`)
		// see the dispatcher contract (JSON/statics), never the SPA shell.
		// Neutral agents on page routes have wants_html set (page_is_nav),
		// so they correctly fall through to the shell below.
		if !wants_html && !wants_json && !is_sse {
			ctx.res.set_status(http.status_from_int(status))
			mut probe_ct := out.res.headers['Content-Type'] or { out.res.headers['content-type'] or { '' } }
			if probe_ct == '' {
				probe_ct = if out.res.is_bytes { 'application/octet-stream' } else { 'application/json' }
			}
			if out.res.is_bytes {
				return ctx.send_response_to_client(probe_ct, out.res.body_bytes.bytestr())
			}
			return ctx.send_response_to_client(probe_ct, body)
		}
		s, ct, sb := serve_static(dist, path)
		ctx.res.set_status(http.status_from_int(s))
		return ctx.send_response_to_client(ct, sb)
	}
	// API response: Hand translates the SwelteResponse envelope 1:1 into
	// veb calls (set_status, custom headers, cookies already set above).
	// Binary (is_bytes) sends raw bytes with the handler's Content-Type;
	// text/JSON sends the body with Content-Type (default application/json).
	// @[error]: sanitize the JSON error message before it leaves the server.
	mut resp_ct := out.res.headers['Content-Type'] or { out.res.headers['content-type'] or { '' } }
	if resp_ct == '' {
		resp_ct = if out.res.is_bytes { 'application/octet-stream' } else { 'application/json' }
	}
	ctx.res.set_status(http.status_from_int(status))
	for k, v in out.res.headers {
		if k.to_lower() == 'content-type' { continue }
		ctx.res.header.set_custom(k, v) or {}
	}
	if out.res.is_bytes {
		return ctx.send_response_to_client(resp_ct, out.res.body_bytes.bytestr())
	}
	if status >= 400 && body.contains('"error":"') {
		msg := swelte_sanitize_error(body.all_after('"error":"').all_before('"'), status)
		body = body.all_before('"error":"') + '"error":"' + msg + '"' + body.all_after('"error":"').all_after('"')
	}
	return ctx.send_response_to_client(resp_ct, body)
}

// §14 SSE (true streaming): veb takeover + producer/writer split.
// WHY TWO THREADS: time.sleep in the same thread that calls
// send_message parks V's scheduler — all frames flush at once
// (proven: sleeps-in-writer bundles; channel-split paces).
// So the user fn runs as a PRODUCER (sleeps/waits/upstream reads OK)
// feeding a channel; the WRITER only sends. Client disconnect:
// send_message errors, writer breaks, producer's sends drop.
// Handler-timeout watchdog does NOT apply (long-lived by design);
// SWELTE_SSE_MAX_EVENTS caps runaway streams.
fn swelte_sse_max_events() int {
	return int(swelte_env_int('SWELTE_SSE_MAX_EVENTS', 10000))
}

struct SwelteSseJob {
	prefix    string
	qualifier string
	req       routes.SwelteRequest
	pch       chan []string
	done      chan bool
	events    []string
	lifecycle &SwelteLifecycle
	subscriptions &SwelteSubscriptions
}

// §SSR: engine hook. Core ships the sidecar proxy (SWELTE_SSR_URL);
// the QJS prod embed replaces this file's other half at generate() time:
// when routes/swelte_qjs_bridge.v exists (adapter build), SWELTE_SSR=1
// routes here first (embedded QuickJS, no sidecar), else the URL proxy.
// Default (neither): not-ok → Hand's SPA/static fallback.
fn swelte_ssr_enabled() bool {
	if os.getenv_opt('SWELTE_SSR') or { '' } == '1' {
		return true
	}
	return (os.getenv_opt('SWELTE_SSR_URL') or { '' }).len > 0
}

fn swelte_render_page(route string, props_json string) (string, bool) {
	html, ok, _ := swelte_render_detailed(route, props_json)
	return html, ok
}

fn swelte_render_detailed(route string, props_json string) (string, bool, string) {
	// Embedded QJS first (prod): the adapter's bridge (routes module)
	// compiles in when `swelte build` ran with @swelte/ssr-qjs; core-only
	// builds compile against generate()'s stub (same symbol, returns
	// not-ok — SWELTE_SSR=1 without a bridge falls through to the proxy).
	// So: SWELTE_SSR=1 → embedded; else URL proxy; else not-ok.
	// The embedded bridge returns head+BODY joined by the
	// `<!--ssr-head-body-->` marker (or body alone when no <svelte:head>);
	// the sidecar returns the {html, head} envelope. Both split below.
	if os.getenv_opt('SWELTE_SSR') or { '' } == '1' {
		return routes.swelte_qjs_render_detailed(route, props_json)
	}
	url := os.getenv_opt('SWELTE_SSR_URL') or { '' }
	if url == '' {
		_ = route
		_ = props_json
		return '', false, 'renderer unavailable'
	}
	// Dev sidecar (node): POST { route, props } -> { html, head }.
	// Any failure (down, timeout, 5xx) → not-ok → SPA/static fallback.
	body := '{"route":' + swelte_json_str(route) + ',"props":' + props_json + '}'
	mut resp := http.post_json(url, body) or { return '', false, 'sidecar unavailable' }
	if resp.status_code != 200 {
		return '', false, 'sidecar failed'
	}
	// Envelope: {"html":"...","head":"..."}. Both flow into the shell via
	// the ssr-body / ssr-head placeholder fill below.
	html := swelte_json_field(resp.body, 'html')
	if html == '' {
		return '', false, 'sidecar returned empty HTML'
	}
	head := swelte_json_field(resp.body, 'head')
	return head + '<!--ssr-head-body-->' + html, true, ''
}

// Split the bridge/sidecar `head + marker + body` form into the
// (html, head, ok) triple Hand fills into the shell. Marker absent →
// body-only (no <svelte:head> on the page, or legacy bridge).
fn swelte_split_head_body(s string, ok bool) (string, bool) {
	if !ok || s == '' {
		return '', false
	}
	marker := '<!--ssr-head-body-->'
	idx := s.index(marker) or { return s, true }
	return s[idx + marker.len..], true
}

// Head for a page render: the slice before the marker. The
// envelope/bridge carries `head + marker + body`; Hand splits once and
// fills both placeholders. Empty when the page has no <svelte:head>.
fn swelte_page_head_split(s string) string {
	marker := '<!--ssr-head-body-->'
	idx := s.index(marker) or { return '' }
	return s[..idx]
}

// Minimal JSON string-field extractor (flat envelope only — the sidecar
// contract is fixed: {"html":..,"head":..} or {"error":..}).
fn swelte_json_field(body string, key string) string {
	needle := '"' + key + '":"'
	start := body.index(needle) or { return '' }
	mut i := start + needle.len
	mut out := ''
	for i < body.len {
		c := body[i]
		if c == `\\` && i + 1 < body.len {
			n := body[i + 1]
			if n == `"` {
				out += '"'
			} else if n == `n` {
				out += '\n'
			} else if n == `\\` {
				out += '\\'
			} else {
				out += n.ascii_str()
			}
			i += 2
			continue
		}
		if c == `"` {
			break
		}
		out += c.ascii_str()
		i++
	}
	return out
}

fn swelte_json_str(s string) string {
	mut out := '"'
	for c in s.bytes() {
		if c == `"` {
			out += '\\"'
		} else if c == `\\` {
			out += '\\\\'
		} else if c < 32 {
			out += '\\u00' + c.hex()
		} else {
			out += c.ascii_str()
		}
	}
	return out + '"'
}

// Shell for SSR fill: dist/index.html when present, else minimal shell
// with the same placeholders (dev without vite build, or custom setups).
fn swelte_shell_for(dist string, path string) string {
	_ = path
	if dist != '' {
		index := dist + '/index.html'
		if os.exists(index) {
			data := os.read_bytes(index) or { return swelte_min_shell() }
			return data.bytestr()
		}
	}
	return swelte_min_shell()
}

fn swelte_min_shell() string {
	return '<!doctype html><html><head><meta charset="utf-8"><!--ssr-head--></head><body><div id="app"><!--ssr-body--></div></body></html>'
}

fn swelte_send_envelope(mut ctx Ctx, res routes.SwelteResponse) veb.Result {
	ctx.res.set_status(http.status_from_int(res.status))
	for k, v in res.headers { ctx.res.header.set_custom(k, v) or {} }
	for cookie in res.cookies { ctx.res.header.add(.set_cookie, cookie.to_header()) }
	return ctx.send_response_to_client('application/json', res.body)
}

fn swelte_stream_request(mut ctx Ctx, prefix string, input routes.SwelteRequest) !routes.SwelteRequest {
	req := routes.swelte_guard_for(prefix, input)!
	meta := routes.swelte_stream_meta(prefix, req)!
	for k, v in meta.headers { ctx.res.header.set_custom(k, v) or {} }
	for cookie in meta.cookies { ctx.res.header.add(.set_cookie, cookie.to_header()) }
	if meta.status >= 300 && meta.status < 400 {
		return routes.swelte_redirect_error(meta.headers['Location'] or { meta.headers['location'] or { '/' } }, meta.status)
	}
	if meta.status >= 400 { return routes.swelte_error(meta.status, 'stream rejected') }
	return req
}

fn swelte_script_json(value string) string {
	return value.replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
}

fn swelte_serve_page(mut ctx Ctx, path string, query map[string]string, headers map[string]string, cookies map[string]string, protocol bool) veb.Result {
	return swelte_serve_page_form(mut ctx, path, query, headers, cookies, protocol, 'null', 0)
}

fn swelte_serve_page_form(mut ctx Ctx, path string, query map[string]string, headers map[string]string, cookies map[string]string, protocol bool, form string, form_status int) veb.Result {
	prefix, params := routes.swelte_load_route(path)
	identity, pattern := routes.swelte_page_identity(prefix)
	request := routes.SwelteRequest{query: query, headers: headers, cookies: cookies, params: params, method: 'GET', path: path}
	ch := chan routes.SwelteLoadResult{cap: 1}
	if !ctx.lifecycle.begin() { ctx.res.set_status(.service_unavailable); return ctx.send_response_to_client('text/plain', 'server stopping') }
	spawn swelte_load_spawned(prefix, request, ch, ctx.lifecycle)
	limits := swelte_limits_for(path)
	budget := if limits.timeout_ms > 0 { i64(limits.timeout_ms) } else { swelte_handler_timeout_ms() }
	mut loaded := routes.SwelteLoadResult{}
	select {
		result := <-ch { loaded = result }
		budget * time.millisecond { loaded = routes.SwelteLoadResult{status: 504, body: '{"message":"load timeout"}'} }
	}
	if form_status >= 400 && loaded.status == 200 { loaded.status = form_status }
	if form_status >= 500 { loaded.status = form_status; loaded.body = form }
	mut data := if loaded.body == '' { '{}' } else { loaded.body }
	json2.decode[json2.Any](data) or { loaded.status = 500; data = '{}' }
	mut level_json := []string{}
	mut merged := map[string]json2.Any{}
	for key in loaded.level_order {
		raw := loaded.levels[key] or { '{}' }
		if routes.swelte_compat() {
			fields := json2.decode[map[string]json2.Any](raw) or {
				loaded.status = 500
				map[string]json2.Any{}
			}
			for k, v in fields { merged[k] = v }
			level_json << json.encode(key) + ':' + raw
		} else {
			level_json << json.encode(key) + ':' + raw
		}
	}
	if routes.swelte_compat() && loaded.level_order.len > 0 { data = json2.encode(merged) }
	mut error_json := 'null'
	if loaded.status >= 400 && (form_status == 0 || form_status >= 500) {
		fields := json2.decode[map[string]json2.Any](loaded.body) or { map[string]json2.Any{} }
		message := (fields['message'] or { fields['error'] or { json2.Any('load failed') } }).str()
		swelte_request_report(&ctx, if form_status >= 500 { 'action-error' } else { 'load-error' }, loaded.status, message)
		error_json = '{"status":' + loaded.status.str() + ',"message":' + json.encode(swelte_sanitize_error(message, loaded.status)) + '}'
		data = '{}'
	}
	location := loaded.headers['Location'] or { loaded.headers['location'] or { '' } }
	mut redirect_json := 'null'
	if loaded.status >= 300 && loaded.status < 400 && location != '' { redirect_json = json.encode(location) }
	host := headers['Host'] or { headers['host'] or { 'localhost' } }
	origin := os.getenv_opt('SWELTE_ORIGIN') or { 'http://' + host }
	url := origin.trim_right('/') + ctx.req.url
	mut payload := '{"version":1,"compat":' + routes.swelte_compat().str() + ',"url":' + json.encode(url) + ',"route":{"id":' + json.encode(identity) + ',"pattern":' + json.encode(pattern) + '},"params":' + json.encode(params) + ',"data":' + data + ',"levels":{' + level_json.join(',') + '},"form":' + form + ',"status":' + loaded.status.str() + ',"error":' + error_json + ',"redirect":' + redirect_json + '}'
	filtered, allowed := swelte_serialized_lookup(path)
	for k, v in loaded.headers {
		if filtered && k.to_lower() != 'location' {
			mut keep := false
			for name in allowed { if name.to_lower() == k.to_lower() { keep = true; break } }
			if !keep { continue }
		}
		ctx.res.header.set_custom(k, v) or {}
	}
	for cookie in loaded.cookies { ctx.res.header.add(.set_cookie, cookie.to_header()) }
	ctx.res.header.set_custom('Cache-Control', 'private, no-store') or {}
	ctx.res.header.set_custom('Vary', 'X-Swelte-Load, Accept, Cookie') or {}
	if protocol {
		// Fetch cannot inspect a manual redirect response; carry its real
		// status/location in the envelope without following it on the server.
		ctx.res.set_status(http.status_from_int(if redirect_json != 'null' { 200 } else { loaded.status }))
		return ctx.send_response_to_client('application/json', payload)
	}
	ctx.res.set_status(http.status_from_int(loaded.status))
	if redirect_json != 'null' { return ctx.send_response_to_client('text/html; charset=utf-8', '') }
	dist := os.getenv_opt('SWELTE_DIST') or { '' }
	mut shell := swelte_shell_for(dist, path)
	if swelte_ssr_enabled() && !routes.swelte_no_ssr(path) {
		joined, ok, detail := swelte_render_detailed(if error_json != 'null' { '/+error' } else { path }, payload)
		if ok {
			head := swelte_page_head_split(joined)
			body, _ := swelte_split_head_body(joined, true)
			if body.contains('data-swelte-render-error="1"') {
				swelte_request_report(&ctx, 'ssr-error', 500, if detail == '' { 'render failed' } else { detail })
				eprintln('[swelte:ssr] route=' + path + ' reason=render-error')
				ctx.res.set_status(.internal_server_error)
				if (os.getenv_opt('SWELTE_SSR_STRICT') or { '' }) == '1' { return ctx.send_response_to_client('text/plain', 'swelte: expected SSR render failed') }
				mut failure := json2.decode[map[string]json2.Any](payload) or { map[string]json2.Any{} }
				failure['status'] = json2.Any(500)
				failure['error'] = json2.Any({'status': json2.Any(500), 'message': json2.Any('render failed')})
				failure['data'] = json2.Any(map[string]json2.Any{})
				failure['form'] = json2.null
				payload = json2.encode(failure)
			}
			shell = swelte_fill_ssr(shell, head, body)
		} else {
			swelte_request_report(&ctx, 'ssr-error', 500, if detail == '' { 'renderer unavailable or budget exceeded' } else { detail })
			if (os.getenv_opt('SWELTE_SSR_STRICT') or { '' }) == '1' {
				ctx.res.set_status(.internal_server_error)
				return ctx.send_response_to_client('text/plain', 'swelte: expected SSR render failed')
			}
		}
	}
	state := '<script type="application/json" id="__swelte_page">' + swelte_script_json(payload) + '</script>'
	shell = if shell.contains('</body>') { shell.replace('</body>', state + '</body>') } else { shell + state }
	if loaded.status == 200 && form_status == 0 && loaded.cookies.len == 0 && swelte_isr_seconds(path) > 0 {
		mut public := true
		for key, value in loaded.headers {
			if key.to_lower() == 'cache-control' && (value.to_lower().contains('private') || value.to_lower().contains('no-store')) { public = false }
			if key.to_lower() == 'vary' { public = false }
		}
		if public { ctx.res.header.set_custom('X-Swelte-Isr-Public', '1') or {} }
	}
	return ctx.send_response_to_client('text/html; charset=utf-8', shell)
}

fn swelte_load_spawned(prefix string, request routes.SwelteRequest, ch chan routes.SwelteLoadResult, lifecycle &SwelteLifecycle) {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	defer { state.end() }
	result := routes.swelte_load_for(prefix, request) or { routes.SwelteLoadResult{status: 500, body: '{"message":"load failed"}'} }
	ch <- result
}

// Page-data path: resolve `path` to a routes prefix (same precedence as
// swelte_route), build a SwelteRequest, run the load cascade.
// Any throw → status-carrying envelope (typed throws via
// swelte_load_err_typed, plain throws keep the '{}' default); route miss
// → default envelope (static shell). The envelope carries
// status/headers/cookies for the HTML navigation (P0 item 2);
// the JSON branch (client router fetch) reads the same fields.
fn swelte_page_props(
	path string
	query map[string]string
	headers map[string]string
	cookies map[string]string
	params_hint map[string]string
) routes.SwelteLoadResult {
	_ = params_hint
	prefix, params := routes.swelte_load_route(path)
	if prefix == '' {
		return routes.SwelteLoadResult{ body: '{}' }
	}
	req := routes.SwelteRequest{
		query: query
		form: map[string]string{}
		files: map[string]string{}
		files_bytes: map[string][]u8{}
		raw_body: []u8{}
		headers: headers
		cookies: cookies
		params: params
		method: 'GET'
		path: path
		qualifier: ''
	}
	props := routes.swelte_load_for(prefix, req) or { return routes.SwelteLoadResult{ body: '{}' } }
	return props
}

fn swelte_sse_produce(job SwelteSseJob) {
	mut state := unsafe { &SwelteLifecycle(job.lifecycle) }
	defer { state.end() }
	defer { swelte_room_release(job.subscriptions) }
	// Room mode (future.md #4) is spliced in by renderHarness ONLY when a
	// room route exists (hooks.roomSse): the harness then imports the
	// backend hub module. Without room routes this branch would reference
	// `backend.*` with no import — uncompilable — so the no-room harness
	// below goes straight to emit/list. The room branch lives behind the
	// `// [swelte] room-mode` anchor (see renderHarness roomSse splice).
	// [swelte] room-mode
	if routes.swelte_sse_is_room(job.prefix) {
		// (room branch spliced here when hooks.roomSse)
	} else if routes.swelte_sse_is_emit(job.prefix) {
		emit := fn [job] (e string) bool {
			packet := [e]
			select {
				_ := <-job.done { return false }
				job.pch <- packet { return true }
			}
			return false
		}
		routes.swelte_sse_emit_for(job.prefix, job.qualifier, job.req, emit) or { swelte_stream_report(job.req, err.msg()) }
	} else {
		for e in job.events {
			packet := [e]
			select {
				_ := <-job.done { job.pch.close(); return }
				job.pch <- packet {}
			}
		}
	}
	job.pch.close()
}

fn swelte_serve_sse(mut ctx Ctx, prefix string, qualifier string, req routes.SwelteRequest, events []string) veb.Result {
	if !ctx.lifecycle.begin() { ctx.res.set_status(.service_unavailable); return ctx.send_response_to_client('text/plain', 'server stopping') }
	if !ctx.lifecycle.begin() { ctx.lifecycle.end(); ctx.res.set_status(.service_unavailable); return ctx.send_response_to_client('text/plain', 'server stopping') }
	ctx.takeover_conn()
	if !ctx.lifecycle.track(ctx.conn) { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.conn.close() or {}; return veb.no_result() }
	ctx.conn.set_blocking(false) or { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.lifecycle.close_conn(mut ctx.conn); return veb.no_result() }
	ctx.conn.set_write_timeout(swelte_env_int('SWELTE_STREAM_IDLE_MS', 30000) * time.millisecond)
	ctx.res.header.delete(.content_length)
	ctx.res.header.delete(.transfer_encoding)
	ctx.res.header.set(.content_type, 'text/event-stream')
	ctx.res.header.set(.cache_control, 'no-cache')
	ctx.res.header.set(.connection, 'close')
	ctx.conn.write_string('HTTP/1.1 200 OK\r\n' + ctx.res.header.render() + '\r\n') or { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.lifecycle.close_conn(mut ctx.conn); return veb.no_result() }
	pch := chan []string{cap: 64}
	done := chan bool{}
	job := SwelteSseJob{prefix, qualifier, req, pch, done, events, ctx.lifecycle, &SwelteSubscriptions{}}
	spawn swelte_sse_produce(job)
	spawn swelte_sse_write(ctx.conn, pch, done, job.subscriptions, ctx.lifecycle)
	return veb.no_result()
}

fn swelte_sse_write(connection &net.TcpConn, pch chan []string, done chan bool, subscriptions &SwelteSubscriptions, lifecycle &SwelteLifecycle) {
	mut conn := unsafe { &net.TcpConn(connection) }
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	defer { done.close(); swelte_room_release(subscriptions); state.close_conn(mut conn); state.end() }
	mut sse_conn := &sse.SSEConnection{conn: conn}
	cap := swelte_sse_max_events()
	mut n := 0
	for {
		mut e := ''
		select {
			_ := <-state.stop { break }
			event := <-pch { if event.len == 0 { break }; e = event[0] }
			swelte_env_int('SWELTE_SSE_HEARTBEAT_MS', 15000) * time.millisecond {
				conn.write_string(': swelte heartbeat\n\n') or { break }
				continue
			}
		}
		if e.starts_with('__wait_ms:') {
			ms := e.all_after(':').int()
			if ms > 0 && ms <= 10000 {
				if !swelte_wait_active(ms, state) { break }
			}
			continue
		}
		if n >= cap {
			break
		}
		n++
		sse_conn.send_message(data: e) or { break }
	}
	sse_conn.send_message(data: 'swelte:close') or {}
	sse_conn.send_message(event: 'close', data: 'Closing the connection', retry: -1) or {}
}

struct SwelteByteStreamJob {
	producer fn (routes.SwelteStream) ! @[required]
	chunks chan []u8
	done chan bool
	path string
	lifecycle &SwelteLifecycle
	request_id string
	method string
}

fn swelte_byte_stream_produce(job SwelteByteStreamJob) {
	mut state := unsafe { &SwelteLifecycle(job.lifecycle) }
	defer { state.end() }
	write := fn [job] (bytes []u8) bool {
		if bytes.len == 0 {
			select { _ := <-job.done { return false } else { return true } }
		}
		if bytes.len > int(swelte_env_int('SWELTE_STREAM_CHUNK_LIMIT', 65536)) { return false }
		chunk := bytes.clone()
		select {
			_ := <-job.done { return false }
			job.chunks <- chunk { return true }
		}
		return false
	}
	job.producer(routes.SwelteStream{write, job.done}) or {
		swelte_report(SwelteReport{phase: 'stream-error', request_id: job.request_id, method: job.method, path: job.path, status: 500, message: err.msg()})
		eprintln('[swelte:stream] route=' + job.path + ' reason=producer-error')
	}
	job.chunks.close()
}

fn swelte_serve_stream(mut ctx Ctx, response routes.SwelteResponse, path string) veb.Result {
	if !ctx.lifecycle.begin() { ctx.res.set_status(.service_unavailable); return ctx.send_response_to_client('text/plain', 'server stopping') }
	if !ctx.lifecycle.begin() { ctx.lifecycle.end(); ctx.res.set_status(.service_unavailable); return ctx.send_response_to_client('text/plain', 'server stopping') }
	ctx.res.set_status(http.status_from_int(response.status))
	for k, v in response.headers { ctx.res.header.set_custom(k, v) or {} }
	ctx.res.header.delete(.content_length)
	ctx.res.header.delete(.transfer_encoding)
	ctx.res.header.set(.connection, 'close')
	ctx.takeover_conn()
	if !ctx.lifecycle.track(ctx.conn) { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.conn.close() or {}; return veb.no_result() }
	ctx.conn.set_blocking(false) or { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.lifecycle.close_conn(mut ctx.conn); return veb.no_result() }
	ctx.conn.set_write_timeout(swelte_env_int('SWELTE_STREAM_IDLE_MS', 30000) * time.millisecond)
	ctx.conn.write_string('HTTP/1.1 ' + response.status.str() + ' ' + http.status_from_int(response.status).str() + '\r\n' + ctx.res.header.render() + '\r\n') or { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.lifecycle.close_conn(mut ctx.conn); return veb.no_result() }
	chunks := chan []u8{cap: 8}
	done := chan bool{}
	spawn swelte_byte_stream_produce(SwelteByteStreamJob{response.stream, chunks, done, path, ctx.lifecycle, ctx.request_id, ctx.req.method.str().to_upper()})
	spawn swelte_byte_stream_write(ctx.conn, chunks, done, ctx.lifecycle)
	return veb.no_result()
}

fn swelte_byte_stream_write(connection &net.TcpConn, chunks chan []u8, done chan bool, lifecycle &SwelteLifecycle) {
	mut conn := unsafe { &net.TcpConn(connection) }
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	defer { done.close(); state.close_conn(mut conn); state.end() }
	idle := swelte_env_int('SWELTE_STREAM_IDLE_MS', 30000)
	conn.set_write_timeout(idle * time.millisecond)
	for {
		select {
			_ := <-state.stop { return }
			chunk := <-chunks {
				if chunk.len == 0 { return }
				conn.write(chunk) or { return }
			}
			idle * time.millisecond { return }
		}
	}
}

// §WS (future.md #3): bidirectional socket Rooms over the hub. Upgrade +
// frame pump. The harness takes over the conn, performs the RFC 6455
// handshake itself (no veb WS support — raw frames over the hijacked
// TcpConn), then runs TWO loops: route fn (hub → socket via emit) and
// reader (socket → route fn via the returned channel). Either side ending
// tears everything down (harness reaps hub subs on fn return).
// The whole section below (through swelte_ws_pump) is spliced in by
// renderHarness ONLY when a room/`@[ws]` route exists (hooks.roomSse) —
// without the backend hub module it is uncompilable. The no-room harness
// keeps only the dispatch stub below (ws_prefix never matches: generated
// swelte_ws_route returns '' with no @[ws] routes).
// [swelte] ws-section
struct SwelteWsJob {
	prefix    string
	req       routes.SwelteRequest
	pch       chan string
	inch      chan string
	done      chan bool
	lifecycle &SwelteLifecycle
	subscriptions &SwelteSubscriptions
	produced chan bool
}

fn swelte_serve_ws(mut ctx Ctx, prefix string, req routes.SwelteRequest) veb.Result {
	key := req.headers['Sec-WebSocket-Key'] or { req.headers['sec-websocket-key'] or { '' } }
	if key == '' {
		ctx.res.set_status(.bad_request)
		return ctx.send_response_to_client('application/json', '{"error":"missing Sec-WebSocket-Key"}')
	}
	version := req.headers['Sec-WebSocket-Version'] or { req.headers['sec-websocket-version'] or { '' } }
	// We speak RFC 6455 only (§3 scope control — browsers all send 13).
	if version != '' && version != '13' {
		ctx.res.set_status(.bad_request)
		return ctx.send_response_to_client('application/json', '{"error":"unsupported Sec-WebSocket-Version (want 13)"}')
	}
	accept := backend.ws_accept_key(key)
	ctx.res.set_status(.switching_protocols)
	ctx.res.header.delete(.content_length)
	ctx.res.header.delete(.content_type)
	ctx.res.header.delete(.transfer_encoding)
	ctx.res.header.set(.upgrade, 'websocket')
	ctx.res.header.set(.connection, 'Upgrade')
	ctx.res.header.set_custom('Sec-WebSocket-Accept', accept) or {}
	handshake := 'HTTP/1.1 101 Switching Protocols\r\n' + ctx.res.header.render() + '\r\n'
	if !ctx.lifecycle.begin() { ctx.res.set_status(.service_unavailable); return ctx.send_response_to_client('text/plain', 'server stopping') }
	if !ctx.lifecycle.begin() { ctx.lifecycle.end(); ctx.res.set_status(.service_unavailable); return ctx.send_response_to_client('text/plain', 'server stopping') }
	ctx.takeover_conn()
	mut conn := ctx.conn
	if conn == unsafe { nil } {
		ctx.lifecycle.end(); ctx.lifecycle.end()
		return veb.no_result()
	}
	if !ctx.lifecycle.track(conn) { ctx.lifecycle.end(); ctx.lifecycle.end(); conn.close() or {}; return veb.no_result() }
	conn.set_blocking(false) or { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.lifecycle.close_conn(mut conn); return veb.no_result() }
	conn.set_write_timeout(swelte_env_int('SWELTE_STREAM_IDLE_MS', 30000) * time.millisecond)
	conn.write(handshake.bytes()) or { ctx.lifecycle.end(); ctx.lifecycle.end(); ctx.lifecycle.close_conn(mut conn); return veb.no_result() }
	mut pch := chan string{cap: 64}
	mut inch := chan string{cap: 64}
	mut done := chan bool{cap: 1}
	mut job := SwelteWsJob{prefix: prefix, req: req, pch: pch, inch: inch, done: done, lifecycle: ctx.lifecycle, subscriptions: &SwelteSubscriptions{}, produced: chan bool{cap: 1}}
	spawn swelte_ws_produce(job)
	spawn swelte_ws_pump(mut conn, pch, inch, done, ctx.lifecycle, job.subscriptions, job.produced)
	return veb.no_result()
}

fn swelte_ws_produce(job SwelteWsJob) {
	mut state := unsafe { &SwelteLifecycle(job.lifecycle) }
	defer { job.produced <- true; swelte_room_release(job.subscriptions); state.end() }
	sub := fn [job] (room string) chan string {
		return swelte_room_subscribe(room, job.subscriptions)
	}
	emit := fn [job] (e string) bool {
		// Blocking send preserves echo ordering (a drop here would lose
		// messages) — same idiom as the proven SSE room path. NO `done`
		// observation here: `done` is only closed at pump exit (never
		// sent to), so `<-job.done` would block on EVERY emit while the
		// pump is alive and freeze the route after its first message —
		// the second half of the echo-killer. A `select` check can't
		// observe death either (`select` on a closed chan fires `else`,
		// probed). Death is observed where it matters: the pump closes
		// pch at teardown, so a dead pump unblocks this send via the
		// `or` (fires on close) and produce reaps hub subs; the route's
		// recv loop sees `inch` close.
		job.pch <- e or {
			return false
		}
		return true
	}
	routes.swelte_ws_open_for(job.prefix, job.req, sub, job.inch, emit) or { swelte_stream_report(job.req, err.msg()) }
}

// Single pump task owns the conn for BOTH directions (TcpConn writes
// must serialize — one writer, no races). Hub → socket: non-blocking
// `select` on pch (ready = write it, else = fall through to the socket
// read). Socket → hub: blocking read with a short timeout so hub messages
// still flush promptly; inbound frames go to inch for the route fn.
// Disconnect (client close / fatal framing) or produce-return ends the
// loop: done is closed (broadcast — receivers with `or` unblock), inch is
// closed (route's `select` recv arm dies), produce reaps hub subs.
// NOTE: V `select` on a closed chan fires `else`, NOT the arm (verified
// in probes) — so `done` is NEVER closed while receivers still `select`
// on it; the pump closes it exactly once at the end, and receivers use
// the `or` form (`<-done or {}`) which DOES fire on close.
fn swelte_ws_pump(mut conn net.TcpConn, pch chan string, inch chan string, done chan bool, lifecycle &SwelteLifecycle, subscriptions &SwelteSubscriptions, produced chan bool) {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	defer { done.close(); inch.close(); pch.close(); swelte_room_release(subscriptions); state.close_conn(mut conn); state.end() }
	conn.set_read_timeout(100 * time.millisecond)
	for {
		if state.is_stopping() { return }
		select {
			_ := <-produced {
				for {
					select {
						e := <-pch { backend.ws_write_text(mut conn, e) or { return } }
						else { backend.ws_write_close(mut conn, 1000, '') or {}; return }
					}
				}
			}
			e := <-pch {
				backend.ws_write_text(mut conn, e) or { break }
				continue
			}
			else {}
		}
		msg, alive := backend.ws_read_frame_timeout(mut conn) or { '', false }
		if !alive {
			break
		}
		if msg != '' {
			select {
				_ := <-state.stop { break }
				inch <- msg {}
				swelte_env_int('SWELTE_STREAM_IDLE_MS', 30000) * time.millisecond { break }
			}
		}
	}
	// Unblock a route stuck in `emit`'s pch send: a send's `or` fires on
	// close, so closing pch here lets produce return + reap hub subs.
	// Sole closer is the pump (produce never closes pch). The emit path
	// never observes `done` before sending, so there is no send-vs-close
	// race on pch from the harness side.
}

// [swelte] ws-section-end

@[get; post; put; patch; delete; options; head]
@['/:path...']
pub fn (mut app App) swelte_catchall(mut ctx Ctx, _path string) veb.Result {
	return app.before_request(mut ctx)
}

fn main() {
	port := (os.getenv_opt('PORT') or { '8131' }).int()
	mut app := &App{}
	swelte_open_dev_control(mut app.lifecycle) or { eprintln('[swelte:control] status=error'); exit(1) }
	// [swelte] app-startup
	if !app.lifecycle.is_stopping() {
	// [swelte] background-start: app startup must finish before plugin jobs.
	if (os.getenv_opt('SWELTE_SHUTDOWN_SIGNALS') or { '1' }) != '0' {
		if C.swelte_install_stop_signals() == 0 { panic('cannot install shutdown signals') }
	}
	veb.run_at[App, Ctx](mut app, port: port, family: .ip) or { panic(err.msg()) }
	}
	app.lifecycle.request_stop()
	if app.lifecycle.watching {
		drained := <-app.lifecycle.finished
		if !drained { exit(1) }
	}
	cleanup := chan bool{cap: 1}
	spawn swelte_run_shutdown(cleanup)
	remaining := app.lifecycle.deadline - time.now().unix_milli()
	if remaining <= 0 { eprintln('[swelte:shutdown] status=timeout phase=hook'); exit(1) }
	select {
		ok := <-cleanup { if !ok { exit(1) } }
		remaining * time.millisecond { eprintln('[swelte:shutdown] status=timeout phase=hook'); exit(1) }
	}
	eprintln('[swelte:shutdown] status=complete')
	app.lifecycle.control_emit('stopped')
}

// A loopback render follows ordinary guards/loads with no request credentials.
// The per-instance marker only prevents recursion; it never bypasses guards.
fn swelte_isr_schedule(lifecycle &SwelteLifecycle, path string, host string, file string) {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	state.mu.lock()
	if state.stopping || state.isr_busy[file] || state.isr_busy.len >= 4 { state.mu.unlock(); return }
	state.isr_busy[file] = true
	state.active++
	state.mu.unlock()
	spawn swelte_isr_regenerate(lifecycle, path, host, file)
}

fn swelte_isr_regenerate(lifecycle &SwelteLifecycle, path string, host string, file string) {
	mut state := unsafe { &SwelteLifecycle(lifecycle) }
	defer { state.mu.lock(); state.isr_busy.delete(file); state.mu.unlock(); state.end() }
	mut header := http.new_header(key: .accept, value: 'text/html')
	header.set(.host, host)
	header.add_custom('X-Swelte-Isr', state.instance) or { return }
	port := os.getenv_opt('PORT') or { '8131' }
	response := http.fetch(url: 'http://127.0.0.1:' + port + path, header: header, allow_redirect: false, max_retries: 1, read_timeout: swelte_handler_timeout_ms() * time.millisecond, stop_receiving_limit: 4 * 1024 * 1024) or {
		eprintln('[swelte:isr] route=' + path + ' reason=render-failed'); return
	}
	if response.status_code != 200 || response.body.len >= 4 * 1024 * 1024 || !response.body.trim_space().ends_with('</html>') || (response.header.get_custom('X-Swelte-Isr-Public') or { '' }) != '1' || response.header.contains(.set_cookie) || !response.body.contains('data-swelte-ssr="1"') || response.body.contains('data-swelte-render-error="1"') || response.body.contains('<!--ssr-body-->') { eprintln('[swelte:isr] route=' + path + ' reason=uncacheable status=' + response.status_code.str()); return }
	os.mkdir_all(os.dir(file)) or { return }
	temporary := file + '.' + state.instance + '.tmp'
	defer { os.rm(temporary) or {} }
	os.write_file(temporary, response.body) or { return }
	if C.swelte_atomic_replace(temporary.str, file.str) != 0 { eprintln('[swelte:isr] route=' + path + ' reason=replace-failed') }
}
