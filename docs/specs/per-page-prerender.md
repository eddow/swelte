# Spec (todo): per-page prerender flag

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

## Swelte status (whole-site only)

- Global `swelte.prerender.entries: 'off' | 'static' | 'all'` (+ `concurrency`) in `svelte.config.js` → `.swelte/entries.json` → `swelte build` crawls the built `dist/server` and writes additive `dist/<route>/index.html` (root `/` shell never overwritten). Dynamics expand from sibling `entries.ts` only when `'all'`. See `docs/config.md` §Prerender/SSG.
- No per-page flag: `grep export const prerender` = 0 hits.
- Only per-route knob is runtime SSR opt-out: `export const ssr = false` in the sibling `.ts` (`+page.ts` / `+route.ts`) → V `swelte_no_ssr()` serves the SPA shell. It does **not** filter the prerender crawl (`collectPrerenderEntries` ignores the `ssr` flag).

## Proposed shape (open)

Follow the existing sibling-`.ts` regex pattern (`export const ssr`, `export const chunk` in `engine/core/src/vite/routes.ts`):

```ts
// about/+page.ts (leaf) or about/+route.ts (subtree)
export const prerender = true | false | 'auto'; // default: 'inherit' (absent = follow global mode)
```

- Precedence: leaf > nearest explicit wrapper > global `prerender.entries`.
- Open questions:
  - `false` = exclude from crawl even when global mode covers the route?
  - `'auto'` = prerender + keep dynamic dispatch (manifest already keeps all routes — is `auto` a no-op here, or does it mean skip-when-missing-entries?).
  - Interaction with `entries: 'static'` (dynamics without `entries.ts` can't expand anyway) and `ssr: false` (prerender an SPA shell? skip?).
  - V-only routes (no `.svelte`/`.ts` sibling — where would the flag live?).
  - ISR/offline/target shims unaffected (headers/packaging only).
- Call sites: `collectPrerenderEntries` (filter/partition by flag), `codegen-shape` + `ssr-manifest` tests, `config.md` + `coming-from-sveltekit.md` docs.
