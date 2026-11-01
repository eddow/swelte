# Spec: SSR — open work only

Built design + implementation are recorded in `../ssr.md` (ownership, request
path, `@[load]` cascade, `+error` contract, measured budgets, gate) and in
`@swelte/ssr-qjs` (vendored QuickJS prod embed, `runSsrCheck` three halves).
This file keeps the binding constraints + what remains open.

## Binding constraints (locked)

* `core` stays pure and engine-agnostic: no `svelte/compiler`, QuickJS, or
  `bun` imports in `core`; `build`/`dev`/`preview` never start an engine.
  `SWELTE_SSR_URL` in the environment is the only bridge — `Hand` proxies
  when set, skips when not. Default is SPA/static + JSON, always.
* SSR adapters (e.g. `@swelte/ssr-qjs`, `@swelte/ssr-bun`) extend and
  re-export `@swelte/core`; they own all engine deps.
* Single global `src/routes/+error.svelte`, props
  `{ status?: number; message?: string }`. No per-directory inheritance.
* No async in the QuickJS renderer (use `bun` if needed).
* Two engines, both outside `core`'s hot path: `qjs` (default, embedded
  QuickJS in the V binary) and `bun` (opt-in sidecar, async/streaming/npm
  compat, opts out of single-artifact). Never the default.

## Open

2. **Dev auto-sidecar UX.** `runSsrDev` (`@swelte/ssr-qjs/cli`) boots the
   sidecar + Vite + V with `SWELTE_SSR_URL` wired — adapter-owned by
   design. Locked: `swelte dev` (core) never auto-boots an engine
   (binding constraint above); users who want one-command SSR run
   `swelte-ssr dev`. No `core` change, no flag.
3. **`ssr-bun` (opt-in).** Same `POST {route, props} → {html, head}`
   protocol against `SWELTE_SSR_URL`. Async/streaming/Suspense, npm
   compat, opts out of single-artifact. Excluded from the qjs gate
   (its streaming half is tracked with the bun package when it exists).
4. **§5 gate as CI.** `runSsrCheck` covers sidecar + sidecar-via-Hand
   + prod-binary + `!T` → 500 HTML + bare-machine single-artifact +
   20× repeat-render halves (marker-only assertions, no `<main>`
   assumption) with unit tests on stubs; `qjsc` needs no gate (the C
   glue's ring-cache compiles once per bundle bytes — `qjsc` the binary
   stays unvendored, see `../ssr.md` non-goals).

## Protocol (for implementers)

* QJS prod path: fresh QuickJS runtime+context per request (or small pool),
  bytecode-cached bundle (`JS_ReadObject`, compiled once per bytes) +
  `renderRoute(props)` call, ~50ms timeout → SPA
  fallback, ~16MB cap, no `fs/net/process` shims. Failure anywhere →
  `+error` HTML with the right status, server stays up.
* `bun` role even for qjs users: pre-render/snapshot-test the same
  `render.js` in CI (`bun --hot` in dev) with full-fidelity tooling
  without shipping it.

