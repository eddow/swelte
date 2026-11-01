# SvelteKit equivalence — open work only

Delete this file when empty. Built behavior lives in `docs/` root
(`rpc.md`, `types.md`, `errors.md`, `ssr.md`, `config.md`, `forms.md`,
`cli.md`, `example.md`, `coming-from-sveltekit.md`); deliberate
divergences in `coming-from-sveltekit.md`. This file tracks ONLY what
remains to build — no status reports, no "already done (see X)".

Locked invariants (no item below may change these): single global
`+error.svelte`; `core` engine-agnostic, `Hand`+dispatcher ownership;
`@[load]` server-only; `#routes/` fetch vs `#lib/` WASM split;
verbs are HTTP, `@[rpc]` is protocol-ignorant (typed args-struct in,
typed value out, throw → reject — enforced at generate time);
single-artifact `dist/server`; SPA-first proxy rule.

## 1. Routing

* Custom param matchers via central `src/matchers.v` (`@[matcher]`,
  WASM-safe portable subset — separate file from the lifecycle file,
  which imports `time`/`os`).
* `reroute` / host-based routing → lifecycle file
  (`@[reroute]` in `specs/moar.md`).
* `+route.svelte` manual composition (needs client router for nested
  `<slot/>`/children inheritance).

## 2. Data-loading / client-router

* No universal `+page.ts` load (async parity only when `ssr = false`).
* No `depends()`/`invalidate()`/`invalidateAll()`, no streaming
  `Promise` + `<await>` Suspense.
* No client router: no `goto()`, `preloadData()`, `pushState()`,
  `beforeNavigate`/`afterNavigate`/`onNavigate`, no
  `navigating`/`page`/`updated` stores.
* No server `fetch` wrapper with cookie/auth forwarding in `load`.

## 3. Forms/Actions

* No `use:enhance`/`applyAction` progressive-enhancement cycle
  (needs client router).

## 4. Layouts/Errors/Hooks

* Lifecycle file (`@[startup]`/`@[cron]`/`@[queue]`/`@[reroute]` →
  `specs/moar.md`).

## 5. Rendering modes

* Per-route `ssr=false`-lite: manifest flag → `Hand` skips QJS/sidecar,
  serves SPA shell. No prerendered `.html`, no `csr=false` islands.
* No `entries`/`prerender-crawl`, no SSG/ISR, no
  `adapter-static`/`node`/`auto`/`edge`.
* No service-worker, no offline story, no snapshot export.

## 6. Platform DX

* No `$app/stores`, `$app/state`, `$app/navigation` (need client router).

## First external demand (migrating apps: micro, emw)

### P0 — cannot migrate without (design + build)

A. Lifecycle file (auth session resolution on every request, Sentry
   wrapping, security headers + CSP nonce, locale cookies,
   module/subdomain gating, favicon short-circuit) →
   `specs/moar.md`.
B. Reroute / host-based routing → `@[reroute]` in `specs/moar.md`.

### P2 — later, live without

Client router (goto/invalidate/depends/beforeNavigate), streaming
`<await>`, `parent()`, server fetch wrapper, per-route
ssr/csr/prerender/entries, SSG/ISR/adapters, `snapshot` export.
None block a server-rendered migration.