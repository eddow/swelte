# SvelteKit equivalence — open work only

This file tracks ONLY what remains to build. Delete it when empty.
Built behavior lives in `docs/` root (`rpc.md`, `types.md`,
`errors.md`, `ssr.md`, `config.md`, `forms.md`, `cli.md`,
`example.md`, `coming-from-sveltekit.md`).

Locked invariants (no item below may change these): single global
`+error.svelte`; `core` engine-agnostic, `Hand`+dispatcher ownership;
`@[load]` server-only; `#routes/` fetch vs `#lib/` WASM split;
verbs are HTTP, `@[rpc]` is protocol-ignorant (typed args-struct in,
typed value out, throw → reject — enforced at generate time);
single-artifact `dist/server`; SPA-first proxy rule.
Default is runtime-only (no prerendered `.html`); SSG/ISR below are
additive `dist/*.html` only and never change the single-artifact /
SPA-first defaults.

## 1. Data-loading / client-router — BUILT (2026-11-01)

* Universal sibling load (`admin.ts`/`+page.ts`, typed — ssr-qjs
  `transpileSiblingLoad`, mirror of the `.svelte` `generate: 'server'`
  step, so annotations never reach the QJS bundle; JSDoc-only `.js`
  still accepted; sync when SSR-on, `export const ssr = false` = async
  client-only, excluded from the sync QJS bundle) — `core` manifest
  `hasUniversalLoad` (`siblingLoadSource`: `.ts` preferred, plain-`.js`
  fallback), ssr-qjs `assertUniversalLoadSync` +
  `readUniversalSsrFlag`, `renderRoute` applies before render.
  Illustrated: `examples/something/src/routes/router/`
  (`+page.v` server `@[load]` + `swelte_fetch`, `+page.ts` sync
  transform, `+page.svelte` router/stores) + `router/live/`
  (`ssr=false` async twin).
* `depends()` / `invalidate()` / `invalidateAll()` (`sdk.ts` tag registry).
* Streaming: client `experimental.async` (`templates/base/vite.config.ts`);
  SSR stays sync (QJS, build-error on `await`/`fetch`); `<await>`
  fallback renders server-side, resolves in the browser. SSR-on routes
  stay `<await>`-free (sync `renderRoute` — illustrated:
  `/router` links out to the `ssr=false` twin); `ssr=false` routes
  (`/router/live`) compile the `<svelte:boundary>` client-side only
  (`swelte_no_ssr()` → SPA shell, async sibling load excluded from
  `render.js`).
* Client router in generated `routes.js` + entry-main boot:
  `goto()` / `preloadData()` / `pushState()` / `initSwelteRouter()`,
  `beforeNavigate` (cancellable) / `afterNavigate` / `onNavigate`,
  `page` / `navigating` / `updated` stores (`sdk.ts`,
  `globalThis.__swelteRouterSdk` + `__swelteRoutes` bridges).
  Client mounts merge preloaded JSON into leaf props automatically
  (`leafProps = { params, ...data }`, same shape as SSR props).
  Per-route `ssr=false`-lite: `Hand` skips QJS/sidecar via
  `swelte_no_ssr()` (generated from sibling `export const ssr`),
  serves the SPA shell; async universal loads resolve client-side.
* Server `swelte_fetch` (V-only, in-process dispatch, cookie/auth
  forwarding, `SwelteFetchOut`, never projected to TS/WASM).
* `$app/stores` + `$app/state` (stores) / `$app/navigation` (router fns)
  generated under `.swelte/app/` with `v-shim.d.ts` ambient decls.

## 2. Forms/Actions

* `use:enhance` / `applyAction` progressive-enhancement cycle
  (unblocked — router BUILT §1; `deserialize` + `isFail` already in
  `sdk.ts`, see `forms.md`).

## 3. Server lifecycle (→ `specs/moar.md`)

* `@[cron]` (duration literal, spawn loop — `specs/moar.md`).
* `@[queue]` (name literal, v1 in-process — `specs/moar.md`).

## 4. Rendering modes

* Per-route `ssr=false`-lite — BUILT (see §1).
* `entries` / preroute-crawl enumeration (route list for crawl; no
  prerender implied).
* SSG / ISR (additive `dist/*.html` only; runtime/SPA-first defaults
  unchanged — see invariants).
* Deploy-target shims (`adapter-static` output / `node`-style host /
  `auto` / `edge`): packaging only, no Node runtime (single artifact
  `dist/server` + `dist/` holds).
* Service worker.
* Offline story.
* Snapshot export.