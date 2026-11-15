---
name: swelte-sveltekit-delta
description: Swelte vs SvelteKit migration — what is built and workarounds. Use when porting a SvelteKit app, checking feature parity, or planning migration work.
---

# Swelte ↔ SvelteKit Delta

## Built (routing, hooks, wrappers, raw-body, forms, rendering, targets, offline, export)

Route groups `(group)` stripped from URL · optional `[[slug]]` · `trailingSlash: 'always'|'never'|'ignore'` (env `SWELTE_TRAILING_SLASH` wins, server 301s) · per-route `Params` types (`RouteId` + `Params` atop every `types/routes/*.d.ts`) · `#app/paths` + `#app/environment` virtual stubs · CSP + CSRF + `methodOverride` knobs · `SwelteRequest.locals` + `swelte_cookie_get/set/delete` helpers · `HEAD` via the `GET` arm + CORS preflight · `version` + `name` stamping (`X-Swelte-Version`) · param matchers `[id=integer]` + custom `@[matcher]` in `src/matchers.v` (V + both JS mirrors, portable subset) · `fail`-lite (`isFail`) · `deserialize` · `use:enhance` / `applyAction` (no-JS untouched, with-JS `fetch` + `page.form` fold, redirect via router) · root `+route.v` as global head · `src/app.v` `@[startup]`/`@[reroute]` (boot hook + host/path rewrite) · `+route.svelte` auto-nesting (SPA mount + SSR `renderRoute` compose via `children` snippet, `wrappersByRoute` in manifest, nested `hydrateSwelteRoute` adopts SSR DOM in place) · opt-in service worker (`serviceWorker.enabled` / `SWELTE_SW=1` → additive `dist/sw.js`, auto/manual register, shell + hashed-asset precache, API/JSON/SSE network-only, `Hand` static-first for exact files) · prerender/SSG (`prerender.entries` → `.swelte/entries.json` + additive `dist/*.html`, root shell never overwritten) + native ISR (`swelte.isr` / `SWELTE_ISR`, public queryless HTML cache, background regeneration, atomic replacement and stale-on-error) · deploy targets (`--target` / `swelte.target` → `dist/.swelte-static` / `dist/Dockerfile.swelte` / `dist/_headers`, packaging only) · offline fallback page (`offline.fallback` → `dist/offline.html` + SW precache) · `swelte export` (`entries.json` + `dist/*.html` + contract → `snapshot/`) · sibling `entries.ts` (`export function entries()`) for dynamic crawl expansion · per-route `ssr=false`-lite (`export const ssr = false` in the sibling `.ts` → `Hand` skips rendering, serves the SPA shell; async universal `load` stays client-only).

Core remains engine-agnostic, with `Hand`/dispatcher ownership, server-only
`@[load]`, `#routes/` fetch vs `#lib/` WASM and a native production server.

Directory `+error.svelte` files inherit through physical ancestry, including
route groups, with matching SSR/client selection and parent fallback. Boundaries
retain wrappers strictly above their directory and replace the local wrapper
and page. See `docs/ssr.md` for hydration and unknown-URL behavior.

`raw_body []u8` is available for webhook HMAC checks alongside parsed form/files.
Existing primitives do not establish full application migration parity: page
state, refresh, guarded streams and hydration still require representative
validation. V's native PostgreSQL/HTTP/crypto facilities are reusable backend
dependencies; lack of a Swelte plugin does not imply lack of native support.

## Sources

- `docs/forms.md` — `use:enhance` / `applyAction` cycle (stable)
- `docs/config.md` — prerender/SSG/ISR, targets, offline fallback (stable)
- `docs/cli.md` — `build --target`, `export` (stable)
- `docs/versus.md` — positioning (stable)

Native build-time images: `swelte.images` PNG/JPEG sources → resized WebP + `#app/images` metadata (host libwebp build dependency). Explicit offline mutations: `serviceWorker.outbox` + `enqueueOffline`/`flushOutbox`/`listOutbox`, IndexedDB and Background Sync; endpoints deduplicate `Idempotency-Key`. See `docs/images.md` and `docs/outbox.md`.
