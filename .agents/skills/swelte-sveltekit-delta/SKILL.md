---
name: swelte-sveltekit-delta
description: Swelte vs SvelteKit migration gaps — what is built, what is open, and workarounds. Use when porting a SvelteKit app, checking feature parity, or planning migration work.
---

# Swelte ↔ SvelteKit Delta

> SPEC-DEPENDENT SKILL — this skill tracks `docs/specs/moar.md`. Re-read the spec on every use; refresh this skill whenever it changes. See `docs/specs/skills.md` for the maintenance contract.

## Built (routing, hooks, wrappers, forms, rendering, targets, offline, export)

Route groups `(group)` stripped from URL · optional `[[slug]]` · `trailingSlash: 'always'|'never'|'ignore'` (env `SWELTE_TRAILING_SLASH` wins, server 301s) · per-route `Params` types (`RouteId` + `Params` atop every `types/routes/*.d.ts`) · `#app/paths` + `#app/environment` virtual stubs · CSP + CSRF + `methodOverride` knobs · `SwelteRequest.locals` + `swelte_cookie_get/set/delete` helpers · `HEAD` via the `GET` arm + CORS preflight · `version` + `name` stamping (`X-Swelte-Version`) · param matchers `[id=integer]` + custom `@[matcher]` in `src/matchers.v` (V + both JS mirrors, portable subset) · `fail`-lite (`isFail`) · `deserialize` · `use:enhance` / `applyAction` (no-JS untouched, with-JS `fetch` + `page.form` fold, redirect via router) · root `+route.v` as global head · `src/server.v` `@[startup]`/`@[reroute]` (boot hook + host/path rewrite) · `+route.svelte` auto-nesting (SPA mount + SSR `renderRoute` compose via `children` snippet, `wrappersByRoute` in manifest, nested `hydrateSwelteRoute` adopts SSR DOM in place) · opt-in service worker (`serviceWorker.enabled` / `SWELTE_SW=1` → additive `dist/sw.js`, auto/manual register, shell + hashed-asset precache, API/JSON/SSE network-only, `Hand` static-first for exact files) · prerender/SSG (`prerender.entries` → `.swelte/entries.json` + additive `dist/*.html`, root shell never overwritten) + ISR-lite headers (`SWELTE_ISR` → `Cache-Control: s-maxage` + `X-Swelte-Revalidate`, headers only) · deploy targets (`--target` / `swelte.target` → `dist/.swelte-static` / `dist/Dockerfile.swelte` / `dist/_headers`, packaging only) · offline fallback page (`offline.fallback` → `dist/offline.html` + SW precache) · `swelte export` (`entries.json` + `dist/*.html` + contract → `snapshot/`) · sibling `entries.ts` (`export function entries()`) for dynamic crawl expansion.

Additive only: none of this changes the locked invariants (single global `+error.svelte`, engine-agnostic core, `Hand`+dispatcher ownership, server-only `@[load]`, `#routes/` fetch vs `#lib/` WASM split, single-artifact `dist/server`, SPA-first proxy).

## Open (single list — moar only)

Layouts/errors/hooks remainder (`@[cron]`, `@[queue]` — `specs/moar.md`) · `+server.ts`-style raw-body escape hatch for webhook HMAC verification (raw-body mode per file or a tiny TS sidecar).

Plus `docs/specs/moar.md`: `@[cron]` + `@[queue]` in `src/server.v` — pure V, no TS sidecar, no SvelteKit `handle/handleFetch/handleError` surface.

## Sources

- `docs/specs/moar.md` — server lifecycle (VOLATILE: filename + `@[queue]` transport TBD)
- `docs/forms.md` — `use:enhance` / `applyAction` cycle (stable)
- `docs/config.md` — prerender/SSG/ISR, targets, offline fallback (stable)
- `docs/cli.md` — `build --target`, `export` (stable)
- `docs/versus.md` — positioning (stable)
