// `swelte init <dir>`: scaffold a new Swelte project.
// Mirrors examples/something: vite.config.ts (env-aware vBackendUrl),
// svelte.config.js, tsconfig wildcards, index.html, src/{main.ts,app.html,
// routes/index.{svelte,v},routes/api/greet.v,lib/crypto/hash.v}, server.v
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
  write(root, 'package.json', `{
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
`)
  write(root, 'vite.config.ts', `import { defineConfig } from 'vite';
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
`)
  write(root, 'svelte.config.js', `import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  preprocess: vitePreprocess()
};
`)
  write(root, 'tsconfig.json', `{
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
`)
  write(root, 'index.html', `<!doctype html>
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
`)
  write(root, 'src/main.ts', `import { mount } from 'svelte'
import Index from './routes/index.svelte'

mount(Index, { target: document.getElementById('app')! })
`)
  write(root, 'src/app.html', `<!doctype html>
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
`)
  write(root, 'src/routes/index.svelte', `<script lang="ts">
import { get_greeting } from '#routes/index.v'
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
`)
  write(root, 'src/routes/index.v', `// Swelte route handler for \`/\`.
module index

@[get]
pub fn get_greeting(req SwelteRequest) string {
	name := req.query['payload'] or { '""' }
	return 'Hello, ' + name.trim('"') + '!'
}
`)
  write(root, 'src/routes/api/greet.v', `// Swelte API route \`/api/greet\`.
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
`)
  write(root, 'src/lib/crypto/hash.v', `// Swelte isomorphic lib. Same V compiles to native + \`v -b wasm\`.
module crypto

pub struct HashArgs {
pub:
	input string
}

@[rpc]
pub fn hash_string(args HashArgs) string {
	return 'hash(' + args.input + ')'
}
`)
  // server.v: Hand + static-file serving + main (calls generated routes/).
  // Copied from the proven something example (BUILD_SERVED below).
  write(root, 'server.v', `module main

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
	// Path traversal guard.
	if rel.contains('..') {
		return 403, 'application/json', '{"error":"forbidden"}'
	}
	full := dist + '/' + rel
	if !os.exists(full) || os.is_dir(full) {
		// SPA fallback: unknown path serves index.html (client router owns it).
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
	mut query := map[string]string{}
	if url.contains('?') {
		for part in url.all_after('?').split('&') {
			if part == '' {
				continue
			}
			idx := part.index('=') or { -1 }
			if idx < 0 {
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
			if v == '' {
				qualifier = k
				break
			}
		}
	}
	status, body := routes.swelte_route(path, req.method.str().to_upper(), query, headers, cookies, req.data, content_type, qualifier)
	// Static fallback (preview/prod): API 404 + dist/ present -> serve file.
	// Dev (no dist/): keep the JSON 404 so the Vite proxy can tell.
	dist := os.getenv_opt('SWELTE_DIST') or { '' }
	if dist != '' && req.method == .get && (path == '/' || (status == 404 && body.contains('not found'))) {
		s, ct, sb := serve_static(dist, path)
		r.header.set(.content_type, ct)
		r.status_code = s
		r.body = sb
		return r
	}
	r.header.set(.content_type, 'application/json')
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
`)
  write(root, '.gitignore', `# build outputs — never commit
.svelte/
routes/
dist/
server
.DS_Store
node_modules/
`)
  ctx.log(`scaffolded ${root}`)
  ctx.log('next: npm install && swelte dev')
}
