---
name: swelte-sveltekit-delta
description: Swelte vs SvelteKit migration gaps — what is built, what is open, and workarounds. Use when porting a SvelteKit app, checking feature parity, or planning migration work.
---

# Swelte ↔ SvelteKit Delta

> SPEC-DEPENDENT SKILL — this skill tracks `docs/specs/sveltekit.md` and `docs/specs/moar.md`. Re-read both specs on every use; refresh this skill whenever they change. See `docs/specs/skills.md` for the maintenance contract.

## Built (routing, hooks, wrappers, forms, offline shell)

Route groups `(group)` stripped from URL · optional `[[slug]]` · `trailingSlash: 'always'|'never'|'ignore'` (env `SWELTE_TRAILING_SLASH` wins, server 301s) · per-route `Params` types (`RouteId` + `Params` atop every `types/routes/*.d.ts`) · `#app/paths` + `#app/environment` virtual stubs · CSP + CSRF + `methodOverride` knobs · `SwelteRequest.locals` + `swelte_cookie_get/set/delete` helpers · `HEAD` via the `GET` arm + CORS preflight · `version` + `name` stamping (`X-Swelte-Version`) · param matchers `[id=integer]` + custom `@[matcher]` in `src/matchers.v` (V + both JS mirrors, portable subset) · `fail`-lite (`isFail`) · `deserialize` · root `+route.v` as global head · `src/server.v` `@[startup]`/`@[reroute]` (boot hook + host/path rewrite) · `+route.svelte` auto-nesting (SPA mount + SSR `renderRoute` compose via `children` snippet, `wrappersByRoute` in manifest, nested `hydrateSwelteRoute` adopts SSR DOM in place) · opt-in service worker (`serviceWorker.enabled` / `SWELTE_SW=1` → additive `dist/sw.js`, auto/manual register, shell + hashed-asset precache, API/JSON/SSE network-only, `Hand` static-first for exact files).

Additive only: none of this changes the locked invariants (single global `+error.svelte`, engine-agnostic core, `Hand`+dispatcher ownership, server-only `@[load]`, `#routes/` fetch vs `#lib/` WASM split, single-artifact `dist/server`, SPA-first proxy).

## Open (single list — `specs/sveltekit.md` §§1–5 + moar)

Data-loading / client-router (`goto`/`preloadData`/`pushState`, `depends`/`invalidate`, `beforeNavigate`/`afterNavigate`/`onNavigate`, `navigating`/`page`/`updated` stores, server `fetch` wrapper, streaming `<await>`) · forms `use:enhance`/`applyAction` cycle · layouts/errors/hooks remainder (`@[cron]`, `@[queue]` — `specs/moar.md`) · rendering modes (per-route `ssr=false`-lite, `entries` crawl, SSG/ISR, adapters, offline remainder + snapshot export — SW itself is built, see above) · platform DX (`$app/stores`, `$app/state`, `$app/navigation`) · `+server.ts`-style raw-body escape hatch for webhook HMAC verification (raw-body mode per file or a tiny TS sidecar).

Plus `docs/specs/moar.md`: `@[cron]` + `@[queue]` in `src/server.v` — pure V, no TS sidecar, no SvelteKit `handle/handleFetch/handleError` surface.

## Sources

- `docs/specs/sveltekit.md` — the delta itself (VOLATILE: items leave when built)
- `docs/specs/moar.md` — server lifecycle (VOLATILE: filename + `@[queue]` transport TBD)
- `docs/versus.md` — positioning (stable)
