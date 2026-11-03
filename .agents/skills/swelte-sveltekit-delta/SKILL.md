---
name: swelte-sveltekit-delta
description: Swelte vs SvelteKit migration — what is built and workarounds. Use when porting a SvelteKit app, checking feature parity, or planning migration work.
---

# Swelte ↔ SvelteKit Delta

## Built (routing, hooks, wrappers, raw-body, forms, rendering, targets, offline, export)

Route groups `(group)` stripped from URL · optional `[[slug]]` · `trailingSlash: 'always'|'never'|'ignore'` (env `SWELTE_TRAILING_SLASH` wins, server 301s) · per-route `Params` types (`RouteId` + `Params` atop every `types/routes/*.d.ts`) · `#app/paths` + `#app/environment` virtual stubs · CSP + CSRF + `methodOverride` knobs · `SwelteRequest.locals` + `swelte_cookie_get/set/delete` helpers · `HEAD` via the `GET` arm + CORS preflight · `version` + `name` stamping (`X-Swelte-Version`) · param matchers `[id=integer]` + custom `@[matcher]` in `src/matchers.v` (V + both JS mirrors, portable subset) · `fail`-lite (`isFail`) · `deserialize` · `use:enhance` / `applyAction` (no-JS untouched, with-JS `fetch` + `page.form` fold, redirect via router) · root `+route.v` as global head · `src/app.v` `@[startup]`/`@[reroute]` (boot hook + host/path rewrite) · `+route.svelte` auto-nesting (SPA mount + SSR `renderRoute` compose via `children` snippet, `wrappersByRoute` in manifest, nested `hydrateSwelteRoute` adopts SSR DOM in place) · opt-in service worker (`serviceWorker.enabled` / `SWELTE_SW=1` → additive `dist/sw.js`, auto/manual register, shell + hashed-asset precache, API/JSON/SSE network-only, `Hand` static-first for exact files) · prerender/SSG (`prerender.entries` → `.swelte/entries.json` + additive `dist/*.html`, root shell never overwritten) + ISR-lite headers (`SWELTE_ISR` → `Cache-Control: s-maxage` + `X-Swelte-Revalidate`, headers only) · deploy targets (`--target` / `swelte.target` → `dist/.swelte-static` / `dist/Dockerfile.swelte` / `dist/_headers`, packaging only) · offline fallback page (`offline.fallback` → `dist/offline.html` + SW precache) · `swelte export` (`entries.json` + `dist/*.html` + contract → `snapshot/`) · sibling `entries.ts` (`export function entries()`) for dynamic crawl expansion · per-route `ssr=false`-lite (`export const ssr = false` in the sibling `.ts` → `Hand` skips rendering, serves the SPA shell; async universal `load` stays client-only).

Additive only: none of this changes the locked invariants (single global `+error.svelte`, engine-agnostic core, `Hand`+dispatcher ownership, server-only `@[load]`, `#routes/` fetch vs `#lib/` WASM split, single-artifact `dist/server`, SPA-first proxy).

`raw_body []u8` on `SwelteRequest` is the `+server.ts`-style webhook HMAC escape hatch (raw bytes verbs keep alongside parsed `form`/`files_bytes`) — no open gaps remain.

## Sources

- `docs/forms.md` — `use:enhance` / `applyAction` cycle (stable)
- `docs/config.md` — prerender/SSG/ISR, targets, offline fallback (stable)
- `docs/cli.md` — `build --target`, `export` (stable)
- `docs/versus.md` — positioning (stable)
