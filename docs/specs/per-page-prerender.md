# Spec (todo): per-page prerender flag — IMPLEMENTED (P0 item 1)

SvelteKit has a per-page `prerender` page option
([docs](https://svelte.dev/docs/kit/page-options#prerender)):

```js
// +page.js / +page.server.js / +server.js — or +layout.* for a subtree, root layout for the whole app
export const prerender = true | false | 'auto';
```

- Child layouts/pages override parent layouts (e.g. prerender everything, opt out per page).
- `true` prerenders at build time and **excludes** the route from dynamic-SSR manifests (smaller server).
- `'auto'` prerenders **and** keeps the route in the manifest (e.g. `/blog/[slug]`: prerender popular slugs, server-render the long tail).
- `entries` (`export function entries()`) feeds dynamic params for the crawl.

## Swelte status (per-page, built)

- Global `swelte.prerender.entries: 'off' | 'static' | 'all'` (+ `concurrency`) in `svelte.config.js` → `.swelte/entries.json` → `swelte build` crawls the built `dist/server` and writes additive `dist/<route>/index.html` (root `/` shell never overwritten). Dynamics expand from sibling `entries.ts` only when `'all'`. See `docs/config.md` §Prerender/SSG.
- Per-page flag: `export const prerender = true | false | 'auto'` in the sibling `.ts` (`about/+page.ts` leaf or `about/+route.ts` wrapper subtree) — read by regex (`readPrerenderHint` / `assertPrerenderHint`, `vite/routes.ts`), carried on `SvelteRouteEntry.prerender`, surfaced in `ssr-manifest.json` per route.
- Precedence: leaf > nearest explicit wrapper > global `prerender.entries`.
- Resolved decisions (open questions closed):
  - `false` = exclude from crawl even when global mode covers the route.
  - `'auto'` = include + keep dynamic dispatch. The manifest already keeps all routes, so `auto` ≡ `true` for the crawl (kept as a distinct spelling for SvelteKit familiarity).
  - `ssr: false` does NOT auto-exclude (prerender writes the SPA shell — a static shell is still a useful prerender).
  - `.v`-only routes (no `.svelte`/`.ts` sibling) follow the global mode (no flag carrier).
  - ISR/offline/target shims unaffected (headers/packaging only).
- Call sites: `collectPrerenderEntries` resolves flags + partitions (`partitionPrerender`); bad values are file+line build errors.
- Sibling `.ts` is the only knob carrier (same regex pattern as `export const ssr` / `export const chunk`, now joined by `export const layout`).

```ts
// about/+page.ts (leaf) or about/+route.ts (subtree)
export const prerender = true | false | 'auto'; // default: 'inherit' (absent = follow global mode)
```
