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

## 1. Data-loading / client-router

* Universal `+page.ts` load (async parity only when `ssr = false`).
* `depends()` / `invalidate()` / `invalidateAll()`.
* Streaming `Promise` + `<await>` Suspense.
* Client router: `goto()`, `preloadData()`, `pushState()`,
  `beforeNavigate` / `afterNavigate` / `onNavigate`,
  `navigating` / `page` / `updated` stores.
* Server `fetch` wrapper with cookie/auth forwarding in `load`.

## 2. Forms/Actions

* `use:enhance` / `applyAction` progressive-enhancement cycle
  (needs client router).

## 3. Layouts/Errors/Hooks

* `@[cron]` (duration literal, spawn loop — `specs/moar.md`).
* `@[queue]` (name literal, v1 in-process — `specs/moar.md`).

## 4. Rendering modes

* Per-route `ssr=false`-lite (manifest flag → `Hand` skips QJS/sidecar,
  serves SPA shell; no prerendered `.html`, no `csr=false` islands).
* `entries` / preroute-crawl enumeration.
* SSG / ISR.
* `adapter-static` / `node` / `auto` / `edge`.
* Service worker.
* Offline story.
* Snapshot export.

## 5. Platform DX

* `$app/stores`.
* `$app/state`.
* `$app/navigation` (needs client router).