# tests — unit + e2e showcase for `core` + `ssr-qjs`

Minimal example whose purpose is to be **loaded with unit and e2e tests**
so the result of `core` and `ssr-qjs` stays visible. Sibling of
`examples/something/` (the kitchen-sink demo); this one proves the gates
with 1/10th the surface.

## Routes (deliberately tiny, parity-complete)

- `src/routes/+page.v` — `@[load] load_home` (SSR paint: `hello <who>`)
  + `@[get] get_greeting` / `@[post] save_name` JSON probes.
- `src/routes/+page.svelte` — `<main>` + `server: {greeting}` (SSR-assertable).
- `src/routes/+error.svelte` — global `{ status, message }` (404/500 HTML).
- `src/routes/api/ping.v` — `GET /api/ping → pong` (JSON bypass path).
- `src/routes/boom/+page.v` — `@[load]` always throws `boom`
  (`!T → +error` gate); `+page.svelte` renders the throw.
- `src/lib/calc/add.v` — pure `@[rpc] add({a, b})` (WASM/dev-fallback path)
  + `add_test.v` native V unit (`swelte test` runs it).
- `src/app.v` — `@[error]` sanitizer (`safe:` prefix) + `@[reroute]`
  (`/old-parity` → `/`).
- Parity fixtures (`docs/specs/future.md` §2, one route per item):
  `load-cookie` (envelope headers+cookies), `load-status` (404 envelope),
  `load-redirect` (303+Location envelope), `load-filter`
  (`serializedHeaders: [x-keep]`), `typed` (typed 403 vs plain 400),
  `no-csr` (`csr=false`), `bare-sub/{leaf,wrapped}` + `+route.svelte`
  (`layout=false` cut vs control), `preload` (`data-sveltekit-*` links),
  `limited` (`limits: {rate 2}`), `prerender-true/false` (per-page crawl),
  `dyn-items/[id]` + async `entries.ts` (paginated async entries).

## What proves what

| Layer | Command | Proves |
|---|---|---|
| V unit | `npm test` → `swelte test` (`v test` + contract + snapshot + tsc) | `core` codegen/parity |
| JS unit | `npm run test:unit` (`node:test`) | generated contract, SSR manifest + `renderRoute` compose |
| E2E build | `npm run test:e2e` (same battery × `SERVE=direct` + `SERVE=preview`) | `/` SSR HTML, `/api/ping` JSON, `/nope` 404, `/boom` 400 + full parity battery (load envelope/headers/cookies/status/redirect, typed 403, `@[error]` sanitize, `@[reroute]`, version stamp, layout cut, preload links, per-route limits, manifest flags, prerender dist) |
| E2E dev | `npm run test:e2e:dev` (spawns `swelte dev`) | shared contract vs V backend + Vite SPA shell + RPC proxy + WASM module + `.svelte` HMR + V restart |
| SSR gate | `npm run test:ssr` (`swelte-ssr check`) | sidecar → Hand → prod binary halves + single artifact |

## Run

```sh
npm install
npm test              # swelte test (V + contract + snapshot)
npm run test:unit     # node:test, needs .swelte/ from generate/build
npm run build         # swelte build → dist/server + dist/ssr/render.js
npm run test:e2e      # one battery × SERVE=direct + SERVE=preview
npm run test:e2e:dev  # same battery vs swelte dev (~2min, touches sources then restores)
npm run test:e2e:all  # preview + dev (CI full)
npm run test:full     # swelte test → build → unit → e2e:all
npm run test:ssr      # adapter gate (three halves + repeat-render)
```
