/**
 * Source of truth for every highlighted code block on the docs-site.
 *
 * Each entry: `{ code, lang }`. `scripts/highlight-code.mjs` imports this
 * file (via a .gen loader — plain TS, no build step needed), runs shiki
 * at build time, and writes `snippets.gen.ts` with the highlighted HTML.
 * Pages render via `<Code snippet={codeHtml.key} />` — static HTML, so
 * the sync QuickJS SSR renderer never touches async/WASM.
 *
 * Keep keys stable (`page-block`); `code` is the exact source text.
 */
export interface SnippetSource {
	code: string
	lang: 'v' | 'ts' | 'js' | 'svelte' | 'bash' | 'json' | 'html'
}

export const snippets: Record<string, SnippetSource> = {
	'home-install': {
		lang: 'bash',
		code: `npx @swelte/core init myapp && cd myapp
npm install
npx swelte dev    # Vite :5174 + V backend :8131`,
	},
	'install-steps': {
		lang: 'bash',
		code: `npx @swelte/core init myapp && cd myapp
npm install
npx swelte dev    # Vite :5174 + V backend :8131

# SSR is optional - core runs SPA/static + JSON without it.
# Only if you want server rendering, add the adapter:
# npm install @swelte/ssr-qjs`,
	},
	'install-dev': {
		lang: 'bash',
		code: `npx swelte dev    # this site: examples/docs-site
# open http://localhost:5174`,
	},
	'quickstart-server': {
		lang: 'v',
		code: `module plus_page

@[get]
pub fn get_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { 'world' }
	return 'Hello, ' + name.trim('"') + '!'
}

@[post]
pub fn save_name(req SwelteRequest) string {
	return 'saved:' + (req.form['payload'] or { '' })
}`,
	},
	'quickstart-client': {
		lang: 'svelte',
		code: `<script lang="ts">
	import { get_greeting, save_name } from '#routes/+page.v'
	let name = $state('world')
	let greeting = $state('')
	function greet() {
		get_greeting({ payload: name }).then((g) => (greeting = g))
	}
</script>

<input bind:value={name} class="input input-bordered" />
<button onclick={greet} class="btn btn-primary">Greet</button>`,
	},
	'quickstart-shape': {
		lang: 'bash',
		code: `src/routes/   # server RPC (.v = handler, #routes/... import → fetch)
src/lib/      # isomorphic (.v = local compute, #lib/... import → WASM)
.swelte/      # generated types + stubs + harness (gitignored)
dist/server   # single binary + dist/ static (prod)`,
	},
	'rpc-v': {
		lang: 'v',
		code: `pub struct LoginArgs { pub: payload string }
pub struct Session { pub: id string ... }
@[rpc] pub fn login(args LoginArgs) !Session { ... }`,
	},
	'rpc-ts': {
		lang: 'ts',
		code: `export interface Session { id: string; ... }
export type LoginResult = Session;
export function login(args: { payload: string }): Promise<LoginResult>;`,
	},
	'forms-html': {
		lang: 'html',
		code: `<form action="?delete" method="post">`,
	},
	'forms-v': {
		lang: 'v',
		code: `@[post('delete')]
pub fn delete_account(req SwelteRequest) !string { ... }`,
	},
	'forms-fail': {
		lang: 'ts',
		code: `save_name({ name }).catch((e) => { if (isFail(e)) showInline(e) })`,
	},
	'forms-enhance': {
		lang: 'svelte',
		code: `<script>import { enhance } from '@swelte/core';</script>
<form method="post" use:enhance>…</form>`,
	},
	'errors-curl': {
		lang: 'bash',
		code: `curl -X POST /api/greet -H 'Accept: application/json' -d '{"fn":"nope"}'`,
	},
	'errors-json': {
		lang: 'json',
		code: `{ "error": "unknown fn", "fn": "nope", "path": "/api/greet", "available": ["login"] }`,
	},
	'config-js': {
		lang: 'js',
		code: `import { defineConfig } from '@swelte/core/config';
export default defineConfig({
	preprocess: vitePreprocess(),
	swelte: { name: 'myapp', routesDir: 'src/routes', libDir: 'src/lib',
		outDir: '.swelte', distDir: 'dist', port: 8131, corsOrigin: '',
		trailingSlash: 'ignore', base: '', assets: '', csp: '', csrf: 'ignore',
		methodOverride: false, version: '', target: 'auto' }
});`,
	},
	'ssr-load': {
		lang: 'v',
		code: `@[load] load_page(req SwelteRequest) !PageData { ... }        // level 0
@[load] load_leaf(req SwelteRequest, parent PageData) !Leaf { ... }`,
	},
	'mcp-json': {
		lang: 'json',
		code: `{ "mcpServers": { "swelte": { "command": "node",
	"args": ["./node_modules/@swelte/mcp/dist/index.js"] } } }`,
	},
	'example-imports': {
		lang: 'ts',
		code: `import { get_greeting } from '#routes/+page.v'   // → GET / (JSON)
import { hash_string } from '#lib/crypto/hash.v'   // → local WASM
greeting = get_greeting({ payload: name })  // Promise
hashed = hash_string({ input: name })  // Promise`,
	},
	'plus-install': {
		lang: 'bash',
		code: `npm install @swelte/plus`,
	},
	'plus-vite-config': {
		lang: 'ts',
		code: `import { swelte } from '@swelte/ssr-qjs';
import { jobsPlugin } from '@swelte/plus/jobs'; // or '@swelte/plus'

export default defineConfig({
  plugins: [svelte(svelteConfig), swelte({ vBackendUrl, plugins: [jobsPlugin] })],
});`,
	},
	'plus-cron': {
		lang: 'v',
		code: `module app

@[cron('60s')]
pub fn tick() {
	println('every minute')
}

@[cron('5m,retry=3')]
pub fn sweep() !void {
	// fallible: may throw, retried 3x with 5s-linear backoff
}`,
	},
	'plus-console': {
		lang: 'bash',
		code: `[swelte:cron] tick=tick status=catchup lag=130s   # wake-up behind >= 2 intervals, fires once
[swelte:cron] tick=sweep status=retry attempt=0 err=<msg>
[swelte:cron] tick=sweep status=retry attempt=1 err=<msg>
[swelte:cron] tick=sweep status=ok attempt=2       # recovered
[swelte:cron] tick=sweep status=dead attempt=3 err=<msg>  # exhausted`,
	},
	'plus-db': {
		lang: 'v',
		code: `// src/lib/backend/db.v (scaffolded by swelte migrate)
module backend
import db.sqlite
__global swelte_db = sqlite.DB{}
pub fn db() !sqlite.DB { ... }                    // WAL, shared conn
pub fn kv_set(key string, value string) ! { ... } // exec_none (101)
pub fn kv_get(key string) !string { ... }         // exec + get_string
pub fn kv_del(key string) ! { ... }`,
	},
	'plus-rooms': {
		lang: 'v',
		code: `// cross-request broadcast: any RPC publishes, room SSE streams
@[rpc]
pub fn say(args SayIn) int {
\treturn backend.emit(args.room, args.msg) // delivered count
}

@[sse]
pub fn stream(req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) {
\troom := req.query['room'] or { 'lobby' }
\tch := sub(room) // harness owns it; reaped when this fn returns
\tfor {
\t\tselect {
\t\t\tm := <-ch {
\t\t\t\tif !emit(m) {
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t}
\t\t\t30 * time.second {
\t\t\t\tif !emit('__ping__') {
\t\t\t\t\treturn
\t\t\t\t} // idle heartbeat, client ignores
\t\t\t}
\t\t}
\t}
}`,
	},
	'plus-migrate': {
		lang: 'bash',
		code: `SWELTE_PLUGINS=@swelte/plus/db swelte migrate
# created src/lib/backend/db.v (backend-only helper)
# created db/migrations/001_swelte_kv.sql
# migrated: 001_swelte_kv.sql
# migrate: applied 1 migration(s)`,
	},
	'plus-sockets-echo': {
		lang: 'v',
		code: `// echo socket: whatever the client sends, the server sends back
@[ws]
pub fn ws_echo(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
\t_ = req
\t_ = sub
\tfor {
\t\tmsg := <-recv or { return } // client gone → leave
\t\tif !emit(msg) {
\t\t\treturn
\t\t}
\t}
}`,
	},
	'plus-sockets-rooms': {
		lang: 'v',
		code: `// room socket: joins ?room= (default lobby); hub messages stream out
import backend
import time

pub struct WsSayIn {
pub:
\troom string
\tmsg  string
}

@[rpc]
pub fn ws_say(args WsSayIn) int {
\treturn backend.emit(args.room, args.msg) // delivered count
}

@[ws]
pub fn ws_rooms(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
\troom := req.query['room'] or { 'lobby' }
\tch := sub(room) // harness owns it; reaped when this fn returns
\tfor {
\t\tselect {
\t\t\tm := <-ch {
\t\t\t\tif !emit(m) {
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t}
\t\t\tn := <-recv {
\t\t\t\t_ = n // drained; echo variant sends it back
\t\t\t}
\t\t\t30 * time.second {
\t\t\t\tif !emit('__ping__') {
\t\t\t\t\treturn
\t\t\t\t} // idle heartbeat, client ignores
\t\t\t}
\t\t}
\t}
}`,
	},
	'plus-sockets-client': {
		lang: 'svelte',
		code: `<script lang="ts">
\timport { ws_echo, ws_rooms } from '#routes/api/ws-echo.v'
\timport { onMount } from 'svelte'

\t// TS stubs are URL builders (same route + query as fetch stubs).
\t// The browser opens a native WebSocket itself.
\tlet log = $state<string[]>([])
\tonMount(() => {
\t\tconst echo = new WebSocket(ws_echo())
\t\techo.onmessage = (e) => log.push('echo: ' + e.data)
\t\techo.onopen = () => echo.send('hello')
\t\tconst rooms = new WebSocket(ws_rooms({ room: 'lobby' }))
\t\trooms.onmessage = (e) => {
\t\t\tif (e.data !== '__ping__') log.push('room: ' + e.data)
\t\t}
\t\treturn () => {
\t\t\techo.close()
\t\t\trooms.close()
\t\t}
\t})
<\/script>`,
	},
}
