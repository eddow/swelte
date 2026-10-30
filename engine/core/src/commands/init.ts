// `swelte init <dir>`: scaffold a new Swelte project.
// Mirrors examples/something: vite.config.ts (env-aware vBackendUrl),
// svelte.config.js, tsconfig wildcards, index.html, src/{main.ts,app.html,
// routes/+page.{svelte,v},routes/api/greet.v,lib/crypto/hash.v}, server.v
// (Hand + static + main, calls generated routes/), package.json scripts,
// .gitignore. Then the user runs npm install + swelte dev.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Ctx } from './types.js'

function write(root: string, rel: string, content: string): void {
	const abs = join(root, rel)
	mkdirSync(join(abs, '..'), { recursive: true })
	writeFileSync(abs, content)
}

export async function runInit(ctx: Ctx): Promise<void> {
	const target = ctx.rest[0] ?? String(ctx.opts.dir ?? 'my-swelte-app')
	const root = resolve(String(ctx.opts.root ?? process.cwd()), target)
	if (existsSync(root) && readdirSync(root).length > 0) {
		throw new Error(`target ${root} exists and is not empty (pass an empty dir)`)
	}
	mkdirSync(root, { recursive: true })
	const name = target.split('/').filter(Boolean).pop() ?? 'my-swelte-app'
	write(
		root,
		'package.json',
		`{
  "name": "${name}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "swelte dev",
    "build": "swelte build",
    "preview": "swelte preview"
  },
  "dependencies": {
    "svelte": "^5.0.0",
    "@swelte/core": "^0.1.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0",
    "@swelte/vvm": "^0.1.0"
  }
}
`
	)
	write(
		root,
		'vite.config.ts',
		`import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { swelte } from '@swelte/core/vite';

const vBackendUrl =
  process.env.SWELTE_V_BACKEND_URL ??
  process.env.VITE_SWELTE_V_BACKEND_URL ??
  'http://localhost:8131';

export default defineConfig({
  plugins: [
    svelte(),
    swelte({
      vBackendUrl,
      routesDir: 'src/routes',
      libDir: 'src/lib',
    }),
  ],
});
`
	)
	write(
		root,
		'svelte.config.js',
		`import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  preprocess: vitePreprocess()
};
`
	)
	write(
		root,
		'tsconfig.json',
		`{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "allowJs": true,
    "checkJs": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["vite/client", "svelte"],
    "paths": {
      "#routes/*.v": ["./.swelte/types/routes/*.d.ts"],
      "#lib/*.v": ["./.swelte/types/lib/*.d.ts"],
      "#routes/*": ["./src/routes/*"],
      "#lib/*": ["./src/lib/*"]
    }
  },
  "include": ["src", "vite.config.ts", ".swelte/types", ".swelte/v-shim.d.ts"]
}
`
	)
	write(
		root,
		'index.html',
		`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Swelte — ${name}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`
	)
	write(
		root,
		'src/main.ts',
		`import { mount } from 'svelte'
import Index from './routes/+page.svelte'

mount(Index, { target: document.getElementById('app')! })
`
	)
	write(
		root,
		'src/app.html',
		`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Swelte — ${name}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`
	)
	write(
		root,
		'src/routes/+page.svelte',
		`<script lang="ts">
import { get_greeting } from '#routes/+page.v'
let name = $state('world')
let greeting = $state('')
async function load() { greeting = await get_greeting({ payload: name }) }
</script>
<main>
  <h1>${name}</h1>
  <input bind:value={name} placeholder="your name" />
  <button onclick={load}>Greet (#routes GET)</button>
  {#if greeting}<p>{greeting}</p>{/if}
</main>
`
	)
	write(
		root,
		'src/routes/+page.v',
		`// Swelte route handler for \`/\`.
module plus_page

@[get]
pub fn get_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { '""' }
	return 'Hello, ' + name.trim('"') + '!'
}
`
	)
	write(
		root,
		'src/routes/api/greet.v',
		`// Swelte API route \`/api/greet\`.
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

@[get('slow')]
pub fn slow_probe(req SwelteRequest) string {
	ms_str := req.query['ms'] or { ''}
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
`
	)
	write(
		root,
		'src/routes/api/sibling.v',
		`// Unique-basename fixture (roadmap §17): editors resolve
// ./sibling.v to the real signature via the generated shim.
module sibling

pub struct GreetIn {
pub:
	name string
}

@[rpc]
pub fn g(args GreetIn) string {
	return 'hi ' + args.name
}
`
	)
	write(
		root,
		'src/lib/crypto/hash.v',
		`// Swelte isomorphic lib. Same V compiles to native + \`v -b wasm\`.
module crypto

pub struct HashArgs {
pub:
	input string
}

@[rpc]
pub fn hash_string(args HashArgs) string {
	return 'hash(' + args.input + ')'
}
`
	)
	// server.v: veb App + Ctx + before_request (calls generated routes/).
	// veb owns the socket loop (real streaming via takeover_conn + veb.sse);
	// before_request runs before routing — set ctx.done + return a Result
	// to answer directly, leave it unset to 404 (static/unknown paths).
	write(
		root,
		'server.v',
		`module main

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

// §11 Hardening (global, in Hand — never in \`+route.v\` middleware):
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
// \`__global\` (needs \`-enable-globals\`); single-instance in-memory only.
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

fn (mut app App) before_request(mut ctx Ctx) veb.Result {
	path := if ctx.req.url.contains('?') { ctx.req.url.all_before('?') } else { ctx.req.url }
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
			ctx.res.header.set_custom('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS') or {}
			ctx.res.header.set_custom('Access-Control-Allow-Headers', 'Content-Type, Accept') or {}
			ctx.res.header.set_custom('Access-Control-Max-Age', '86400') or {}
		}
		ctx.res.set_status(.no_content)
		return ctx.send_response_to_client('text/plain', '')
	}
	mut query := map[string]string{}
	if ctx.req.url.contains('?') {
		for part in ctx.req.url.all_after('?').split('&') {
			if part == '' {
				continue
			}
			idx := part.index('=') or { -1 }
			if idx < 0 {
				// Bare key (\`?delete\`): qualifier trigger, value is presence.
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
			// First bare key (\`?delete\`, value == '') doubles as qualifier.
			// Real args (\`?payload=x\`) have values and are skipped.
			if v == '' {
				qualifier = k
				break
			}
		}
	}
	// §14 SSE (true streaming, veb): before_request owns \`ctx\`, so SSE
	// intent is intercepted HERE — never reaches dispatch. On a
	// GET+Accept match on an SSE route: build the SwelteRequest,
	// resolve events via the generated accessor, take over + stream.
	sse_prefix, sse_params := routes.swelte_sse_route(path, ctx.req.method.str().to_upper(), query, headers, qualifier)
	if sse_prefix != '' {
		mut sse_req := routes.SwelteRequest{ query: query, form: map[string]string{}, files: map[string]string{}, headers: headers, cookies: cookies, params: sse_params, method: 'GET', path: path, qualifier: qualifier }
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
	// the \`spawn select\` watchdog keeps the server responsive).
	out := swelte_call_route(path, ctx.req.method.str().to_upper(), query, headers, cookies, ctx.req.data, content_type, qualifier)
	status := out.status
	body := out.body
	set_cookies := out.set_cookies
	if !cors_ok && origin != '' && ctx.req.method != .get && ctx.req.method != .head {
		ctx.res.set_status(.forbidden)
		return ctx.send_response_to_client('application/json', '{"error":"forbidden"}')
	}
	dist := os.getenv_opt('SWELTE_DIST') or { '' }
	if dist != '' && ctx.req.method == .get && !path.starts_with('/api/') && (path == '/' || (status == 404 && body.contains('not found'))) {
		s, ct, sb := serve_static(dist, path)
		ctx.res.set_status(http.status_from_int(s))
		return ctx.send_response_to_client(ct, sb)
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
	for c in cookies_out {
		ctx.res.header.add(.set_cookie, c)
	}
	set_cors(mut ctx, cors_ok, cors_origin, origin)
	if wants_html && status == 200 {
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
pub fn (mut app App) swelte_catchall(mut ctx Ctx) veb.Result {
	return app.before_request(mut ctx)
}

fn main() {
	port := (os.getenv_opt('PORT') or { '8131' }).int()
	mut app := &App{}
	veb.run_at[App, Ctx](mut app, port: port, family: .ip) or { panic(err.msg()) }
}
`,
	)
	write(
		root,
		'.gitignore',
		`# build outputs — never commit
.svelte/
# generated V dispatcher (routes/*.v at the project root) — NOT
# src/routes/, which holds hand-written sources
/routes/
dist/
server
.DS_Store
node_modules/
`
	)
	ctx.log(`scaffolded ${root}`)
	ctx.log('next: npm install && swelte dev')
}
