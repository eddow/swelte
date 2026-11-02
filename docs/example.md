# Example: something

Lives at `examples/something/`. Canonical demo of `.v` imports:
`#routes/` server RPC + `#lib/` isomorphic WASM + structured errors.
Built with `swelte build`, served with `swelte preview` (single
artifact: `dist/server` + `dist/`).

## Layout

```
src/routes/+page.svelte + +page.v   / (get_greeting GET, save_name POST)
src/routes/api/greet.v              /api/greet (get_greeting GET, greet_pure @[rpc] → Session, login POST → Session+cookie, pdf/created probes)
src/routes/boom/+page.svelte + +page.v   /boom (throw fixture: @[load] + @[get] both `return error('boom')` — SSR `!T` gate)
src/routes/users/[id].v             /users/[id] ([id] → req.params['id'])
src/routes/files/[...rest].v        /files/[...rest] (catch-all → req.params['rest'])
src/routes/admin/+route.svelte + +route.v   /admin wrapper (nav + @[before] sess guard / @[after] passthrough)
src/routes/admin/+page.svelte + +page.v     /admin leaf (admin_whoami GET, reads injected x-user)
src/routes/router/+page.v + +page.ts + +page.svelte   /router (§1: server @[load] + swelte_fetch sibling rows + sync universal load + client router + $app/*)
src/routes/router/live/+page.ts + +page.svelte        /router/live (§1: ssr=false twin — async universal load + <await> streaming, SPA shell)
src/lib/crypto/hash.v               isomorphic (hash_string @[rpc] → WASM/dev fallback)
server.v                            Hand + static + main() — calls generated routes/swelte_route
routes/                             generated V dispatcher (regenerating, gitignored)
vite.config.ts                     swelte({ vBackendUrl, routesDir, libDir }) + experimental.async (client <await>; SSR bundle stays sync)
```

## Run

```sh
node engine/core/dist/cli.js dev --port 5174 --backend 8131 --root examples/something
# one command: V backend :8131 + Vite :5174, HMR reload on .v change, Ctrl-C kills both
# manual two-terminal equivalent:
#   PORT=8131 v run .              # V backend :8131 (server.v + generated routes/)
#   npx vite --port 5174           # frontend :5174 → open it, not :8131
```

## Proved

- `/` GET/POST (`get_greeting`/`save_name`), `/api/greet` GET + `greet_pure @[rpc] → Session{id,user,remember,expires_at}` + `login POST → Session+cookie` (verb, HTTP) + `?pdf` (binary) + `?created` (201),
  empty payload → 400, unknown fn → 404 + available, `vite build` green.
- Page buttons: Greet / Save / Hash (`#lib` real WASM) / Login / Stream (`@[sse]` `tick_stream`).
- SSE proven (true streaming via veb, emit mode): `Accept: text/event-stream` on `/api/greet` → 200 with per-event flush (`data: tick 1` ~0.5s, `tick 2` ~1.0s, `tick 3` ~1.5s with `?wait_ms=500` — pacing proves zero buffering); plain JSON GETs keep hitting `@[get]` on the same URL.
- `hash_string` compiles to real WASM (`v -b wasm -os browser`):
  dev `.swelte/dev/crypto/hash.wasm` + prod `dist/assets/app_lib-*.wasm`.
- Generated dispatcher proven: `routes/_page.v` + `routes/api_greet.v` +
  `routes/admin__page.v` + `routes/server_gen.v` (`module routes`,
  `SwelteRequest` + `swelte_route`), one-default-per-verb +
  unique-qualifier enforced at generate time.
- Dynamic segments proven: `/users/42` → `"user:42"`, `/users/` + `/users` →
  404, `/files/a/b/c` → `"files:a/b/c"` (`req.params`; static beats
  dynamic, `[...rest]` last).
- Uploads proven: multipart `POST /api/greet?upload` reads `req.files['file']` (fallible `!string`) → `"got:<name>"`; only filenames kept (bytes parsed then discarded, never persisted); JS stubs send `File`/`Blob` args as `FormData`; 5MB under the 10MB `SWELTE_BODY_LIMIT` cap → 200; over-cap body → 413.
- Throw fixture proven (`/boom`, SSR `!T` gate): `@[load]` throws + `@[get]` throws → JSON `400 {"error":"boom"}` (bypass intact), HTML `400` +error render (marker, status), server stays up (`/` → 200 after); verified bare-machine (`SWELTE_SSR=1`, no sidecar) and sidecar-via-Hand via `runSsrCheck(throwRoute: '/boom')`.
- No-JS proven: `Accept: text/html` POST → 303 + `Location` on success, rendered HTML error on failure; `Accept: application/json` keeps JSON (same handler, content-negotiated). Page has plain `<form method=post>` variants (save + upload).
- Middleware chain proven: `admin/+route.v` `@[before]` rejects without
  `sess` cookie (400 `missing session`), injects `x-user` otherwise;
  `@[after]` passes through; `/` + `/api/greet` unaffected (scoping).
  Folder-root double-claim (`foo.v` + `foo/+page.v`, or `foo.svelte` +
  `foo/+page.svelte`, either extension on either side) is a build error.
  Error matrix: unknown fn → 404 + available, bad JSON → 400,
  missing fn → 400, `!T` → 400 `err.msg()`, unknown path → 404,
  method without handler → 405.
- §1 data-loading / client-router (`/router`, `/router/live`): server
  `@[load]` paints initial props + pulls sibling rows in-process via
  `swelte_fetch` (V-only, non-fallible, cookie/auth forwarded — all async
  lives in `.v`, `.svelte` top level stays pure-sync per the SSR guards);
  sync universal sibling `+page.ts load({ params, props, url })`
  (typed TS — ssr-qjs `transpileSiblingLoad` strips types before the
  QJS bundle, mirror of the `.svelte` preprocessing step)
  merges a view-model in `renderRoute` before render
  (`applyUniversalLoad`, `LOADEDMODS['/router']` in `dist/ssr/render.js`);
  client router (`goto` / `preloadData` / `pushState` /
  cancellable `beforeNavigate` in `onMount` / `afterNavigate`,
  `page` / `navigating` stores, `$app/stores` + `$app/navigation`
  aliases) navigates without reload, preloaded JSON merges as
  `leafProps = { params, ...data }`; `ssr=false` twin `/router/live`
  (sibling `export const ssr = false` → `swelte_no_ssr()` → SPA shell,
  `hasUniversalLoad: 'async'` excluded from `render.js`) resolves its
  async universal load + `<await>` boundary client-side
  (client bundle compiles with `experimental.async`;
  the SSR `generate: 'server'` pass still rejects top-level await —
  `swelte check` clean).

## Stubs (see `rpc.md`, `types.md`)

Dev `/@swelte-dev/<mod>.wasm` micro-modules; prod single bundle
(`__swelteWasmCall` drives `memory` + `main.<fn>` directly).
