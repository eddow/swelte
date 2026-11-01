module main

import net.http
import net.http.mime
import net.urllib
import os
import routes
import strconv
import sync
import time
import veb
import veb.sse

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

// §11 rate-limit state lives on the veb App: before_request runs on the
// App receiver, so per-request calls share the map under a mutex. No
// `__global` (needs `-enable-globals`); single-instance in-memory only.
pub struct Ctx {
	veb.Context
}

pub struct App {
mut:
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
	status      int
	body        string
	set_cookies []string
}

fn swelte_route_spawned(c SwelteRouteCall, ch chan SwelteRouteOut) {
	status, body, set_cookies := routes.swelte_route(c.path, c.method, c.query,
		c.headers, c.cookies, c.locals, c.body, c.content_type, c.qualifier)
	ch <- SwelteRouteOut{status, body, set_cookies}
}

fn swelte_call_route(path string, method string, query map[string]string, headers map[string]string, cookies map[string]string, locals map[string]string, body string, content_type string, qualifier string) SwelteRouteOut {
	budget := swelte_handler_timeout_ms()
	ch := chan SwelteRouteOut{cap: 1}
	call := SwelteRouteCall{path, method, query, headers, cookies, locals, body, content_type,
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

fn (mut app App) before_request(mut ctx Ctx) veb.Result {
	path := if ctx.req.url.contains('?') { ctx.req.url.all_before('?') } else { ctx.req.url }
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
	ip := ctx.ip()
	if app.swelte_rate_limited(ip) {
		ctx.res.set_status(.too_many_requests)
		return ctx.send_response_to_client('application/json', '{"error":"rate limited"}')
	}
	// §11 Hardening: body cap before routing (multipart included —
	// uploads in §13 live under the same knob).
	if ctx.req.data.len > swelte_body_limit() {
		ctx.res.set_status(.request_entity_too_large)
		return ctx.send_response_to_client('application/json', '{"error":"body too large"}')
	}
	mut qualifier := query['q'] or { '' }
	if qualifier == '' {
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
	// §14 SSE (true streaming, veb): before_request owns `ctx`, so SSE
	// intent is intercepted HERE — never reaches dispatch. On a
	// GET+Accept match on an SSE route: build the SwelteRequest,
	// resolve events via the generated accessor, take over + stream.
	sse_prefix, sse_params := routes.swelte_sse_route(path, dispatch_method, query, headers, qualifier)
	if sse_prefix != '' {
		mut sse_req := routes.SwelteRequest{ query: query, form: map[string]string{}, files: map[string]string{}, headers: headers, cookies: cookies, params: sse_params, locals: map[string]string{}, method: 'GET', path: path, qualifier: qualifier }
		if cors_ok {
			ctx.set_header(.access_control_allow_origin, if cors_origin == '*' { '*' } else { origin })
			ctx.res.header.set_custom('Access-Control-Allow-Credentials', 'true') or {}
		}
		if !routes.swelte_sse_is_emit(sse_prefix) {
			routes.swelte_sse_events_for(sse_prefix, qualifier, sse_req) or {
				ctx.res.set_status(.bad_request)
				return ctx.send_response_to_client('application/json', '{"error":"' + err.msg() + '"}')
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
		return swelte_serve_sse(mut ctx, sse_prefix, qualifier, sse_req)
	}
	// (swelte_call_route is sync — veb runs before_request on a worker;
	// the `spawn select` watchdog keeps the server responsive).
	out := swelte_call_route(path, dispatch_method, query, headers, cookies, map[string]string{}, ctx.req.data, content_type, qualifier)
	status := out.status
	body := out.body
	set_cookies := out.set_cookies
	if !cors_ok && origin != '' && ctx.req.method != .get && ctx.req.method != .head {
		ctx.res.set_status(.forbidden)
		return ctx.send_response_to_client('application/json', '{"error":"forbidden"}')
	}
	dist := os.getenv_opt('SWELTE_DIST') or { '' }
	// SSR first (when enabled + HTML navigation): render → fill shell.
	// On render miss/failure, fall through to no-JS/static/SPA below.
	// (Static used to win here — SSR never ran when dist/ existed.)
	// NOTE: `wants_html` without an explicit `text/html` (curl, health
	// probes) is NOT an HTML navigation — those keep JSON/static behavior.
	// Only a real browser Accept (contains text/html, no application/json)
	// enters the SSR chain. This also preserves §12 no-JS form redirects.
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
	// NOTE: the SSR chain below also gates on `text/html`. A page route hit
	// via bare curl (no Accept, or */*) keeps the OLD behavior — JSON body
	// for API-ish hits, static/SPA shell for pages — so probes and the
	// `swelte build` smoke (curl without Accept) never see SSR bytes.
	accept := headers['Accept'] or { headers['accept'] or { '' } }
	wants_html := accept.contains('text/html') && !accept.contains('application/json')
	wants_json := (headers['Accept'] or { headers['accept'] or { '' } }).contains('application/json')
	for c in cookies_out {
		ctx.res.header.add(.set_cookie, c)
	}
	set_cors(mut ctx, cors_ok, cors_origin, origin)
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
	if wants_html && !wants_json && swelte_ssr_enabled() {
		if status == 200 {
			props_json := swelte_page_props(path, query, headers, cookies, map[string]string{})
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
			joined, ok := swelte_render_page('/+error', '{"status":404,"message":"not found"}')
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
			joined, ok := swelte_render_page('/+error', '{"status":' + status.str() + ',"message":"error"}')
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
	if wants_html && status == 200 && ctx.req.method != .get {
		ctx.res.set_status(.see_other)
		return ctx.redirect(path, typ: .see_other)
	}
	if wants_html && status >= 400 {
		mut msg := body.all_after('"error":"')
		if msg != body {
			msg = msg.all_before('"')
		}
		ctx.res.set_status(http.status_from_int(status))
		return ctx.send_response_to_client('text/html; charset=utf-8', '<!doctype html><html><body><p>' + swelte_html_escape(msg) + '</p><p><a href="' + path + '">back</a></p></body></html>')
	}
	// Static/SPA fallback (after SSR attempt above): dist/index.html for
	// / and unknown non-api paths, raw assets otherwise.
	if dist != '' && ctx.req.method == .get && !path.starts_with('/api/') && (path == '/' || (status == 404 && body.contains('not found'))) {
		s, ct, sb := serve_static(dist, path)
		ctx.res.set_status(http.status_from_int(s))
		return ctx.send_response_to_client(ct, sb)
	}
	// §14 SSE (true streaming, veb): the dispatch SSE arm never reaches
	// here — it takes over the conn in swelte_serve_sse below and returns
	// veb.no_result(). This is the JSON path only.
	ctx.res.set_status(http.status_from_int(status))
	return ctx.send_response_to_client('application/json', body)
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
	pch       chan string
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
	// Embedded QJS first (prod): the adapter's bridge (routes module)
	// compiles in only when `swelte build` ran with @swelte/ssr-qjs.
	// SWELTE_SSR=1 without an adapter build fails the V compile (missing
	// symbol) — CORRECT: loud config error, not a silent SPA fallback.
	// So: SWELTE_SSR=1 → embedded; else URL proxy; else not-ok.
	// The embedded bridge returns head+BODY joined by the
	// `<!--ssr-head-body-->` marker (or body alone when no <svelte:head>);
	// the sidecar returns the {html, head} envelope. Both split below.
	if os.getenv_opt('SWELTE_SSR') or { '' } == '1' {
		return routes.swelte_qjs_render_page(route, props_json)
	}
	url := os.getenv_opt('SWELTE_SSR_URL') or { '' }
	if url == '' {
		_ = route
		_ = props_json
		return '', false
	}
	// Dev sidecar (node) / bun proxy: POST { route, props } -> { html, head }.
	// Any failure (down, timeout, 5xx) → not-ok → SPA/static fallback.
	body := '{"route":' + swelte_json_str(route) + ',"props":' + props_json + '}'
	mut resp := http.post_json(url, body) or { return '', false }
	if resp.status_code != 200 {
		return '', false
	}
	// Envelope: {"html":"...","head":"..."}. Both flow into the shell via
	// the ssr-body / ssr-head placeholder fill below.
	html := swelte_json_field(resp.body, 'html')
	if html == '' {
		return '', false
	}
	head := swelte_json_field(resp.body, 'head')
	return head + '<!--ssr-head-body-->' + html, true
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

// `swelte_page_head` is superseded by `swelte_page_head_split` (the head
// rides the render return, split once at the call site). Kept as a stub
// for source-compat; always ''.
fn swelte_page_head(route string, props_json string) string {
	_ = route
	_ = props_json
	return ''
}

// Page-data path: resolve `path` to a routes prefix (same precedence as
// swelte_route), build a SwelteRequest, run the load cascade.
// Any throw → '{}' (renderer falls back to +error via its own path);
// route miss → '{}' (static shell).
fn swelte_page_props(
	path string
	query map[string]string
	headers map[string]string
	cookies map[string]string
	params_hint map[string]string
) string {
	_ = params_hint
	prefix, params := routes.swelte_load_route(path)
	if prefix == '' {
		return '{}'
	}
	req := routes.SwelteRequest{
		query: query
		form: map[string]string{}
		files: map[string]string{}
		headers: headers
		cookies: cookies
		params: params
		method: 'GET'
		path: path
		qualifier: ''
	}
	props := routes.swelte_load_for(prefix, req) or { return '{}' }
	return props
}

fn swelte_sse_produce(job SwelteSseJob) {
	if routes.swelte_sse_is_emit(job.prefix) {
		emit := fn [job] (e string) bool {
			job.pch <- e
			return true
		}
		routes.swelte_sse_emit_for(job.prefix, job.qualifier, job.req, emit) or {}
	} else {
		events := routes.swelte_sse_events_for(job.prefix, job.qualifier, job.req) or {
			[]string{}
		}
		for e in events {
			job.pch <- e
		}
	}
	job.pch.close()
}

fn swelte_serve_sse(mut ctx Ctx, prefix string, qualifier string, req routes.SwelteRequest) veb.Result {
	ctx.takeover_conn()
	pch := chan string{cap: 64}
	job := SwelteSseJob{prefix, qualifier, req, pch}
	spawn swelte_sse_produce(job)
	spawn swelte_sse_write(mut ctx, pch)
	return veb.no_result()
}

fn swelte_sse_write(mut ctx Ctx, pch chan string) {
	mut sse_conn := sse.start_connection(mut ctx.Context)
	cap := swelte_sse_max_events()
	mut n := 0
	for {
		e := <-pch or { break }
		if e.starts_with('__wait_ms:') {
			ms := e.all_after(':').int()
			if ms > 0 && ms <= 10000 {
				time.sleep(time.millisecond * ms)
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
	sse_conn.close()
}

@[get; post; put; patch; delete; options; head]
@['/:path...']
pub fn (mut app App) swelte_catchall(mut ctx Ctx, _path string) veb.Result {
	return app.before_request(mut ctx)
}

fn main() {
	port := (os.getenv_opt('PORT') or { '8131' }).int()
	mut app := &App{}
	veb.run_at[App, Ctx](mut app, port: port, family: .ip) or { panic(err.msg()) }
}
