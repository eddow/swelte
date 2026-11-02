# SvelteKit equivalence — open work only

This file tracks ONLY what remains to build. Delete it when empty.
Built behavior lives in `docs/` root (`rpc.md`, `types.md`,
`errors.md`, `ssr.md`, `config.md`, `forms.md`, `cli.md`,
`example.md`, `coming-from-sveltekit.md`).

> Convention: every open item starts with `TODO:`. Anything marked
> `BUILT` stays only as a pointer to the root doc — it is not work.
> (`ssr=false`-lite and the service worker live here as pointers
> because their remainders — universal-load interplay, offline
> fallback page — still reference them.)

Locked invariants (no item below may change these): single global
`+error.svelte`; `core` engine-agnostic, `Hand`+dispatcher ownership;
`@[load]` server-only; `#routes/` fetch vs `#lib/` WASM split;
verbs are HTTP, `@[rpc]` is protocol-ignorant (typed args-struct in,
typed value out, throw → reject — enforced at generate time);
single-artifact `dist/server`; SPA-first proxy rule.
Default is runtime-only (no prerendered `.html`); SSG/ISR below are
additive `dist/*.html` only and never change the single-artifact /
SPA-first defaults.


## 1. Forms/Actions

* TODO: `use:enhance` / `applyAction` progressive-enhancement cycle
  (unblocked — router BUILT §1; `deserialize` + `isFail` already in
  `sdk.ts`, see `forms.md`).

## 2. Rendering modes

* Per-route `ssr=false`-lite — BUILT (see §1).
* TODO: `entries` / preroute-crawl enumeration (route list for crawl;
  no prerender implied).
* TODO: SSG / ISR (additive `dist/*.html` only; runtime/SPA-first
  defaults unchanged — see invariants).
* TODO: Deploy-target shims (`adapter-static` output / `node`-style
  host / `auto` / `edge`): packaging only, no Node runtime (single
  artifact `dist/server` + `dist/` holds).
* TODO: Offline story remainder — offline fallback page + SSG
  interplay (what gets cached when prerender lands). Skeleton BUILT:
  shell + immutable assets cached, API/SSE network-only.
* TODO: Snapshot export.