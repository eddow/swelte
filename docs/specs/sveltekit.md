# SvelteKit equivalence — open work only

Built behavior lives in `docs/` root (`rpc.md`, `types.md`, `errors.md`,
`ssr.md`, `config.md`, `forms.md`, `cli.md`, `example.md`,
`coming-from-sveltekit.md`). This file tracks ONLY what remains.

Locked invariants (no item below may change these): single global
`+error.svelte`; `core` engine-agnostic, `Hand`+dispatcher ownership;
`@[load]` server-only; `#routes/` fetch vs `#lib/` WASM split;
single-artifact `dist/server`; SPA-first proxy rule.

## 1. Routing (open)

* `[id=integer]` builtins are DONE (`integer` → digits, both sides,
  `Params: number`; see `config.md`). What remains: custom matchers via
  central `src/matchers.v` (`@[matcher]`, WASM-safe portable subset —
  separate file from the lifecycle file, which imports `time`/`os`).
* Route groups `(group)`, optional `[[slug]]`, `trailingSlash` are DONE
  (see `config.md`).
* `+server.ts`-style standalone `Response` endpoints: verbs return
  `string`/struct, `@[after](req,code,body)->(code,body)` only — no
  `headers`/`set-cookie`/stream/redirect control. OPEN (ties to P0-A
  below).
* `reroute` / host-based routing: OPEN → lifecycle file
  (`@[reroute]` in `specs/moar.md`).
* `+route.svelte` is manual composition, not nested `<slot/>`/children
  inheritance. OPEN (needs client router).

## 2. Data-loading / client-router (open)

* `@[load]` is server-only, HTML-navigation only. No universal `+page.ts`
  load (async parity only when `ssr = false` — same rule as SvelteKit).
* No `parent()` (typed `parent T` param instead — built, see `rpc.md`),
  no `depends()`/`invalidate()`/`invalidateAll()`, no streaming `Promise`
  + `<await>` Suspense.
* No client router: no `goto()`, `preloadData()`, `pushState()`,
  `beforeNavigate`/`afterNavigate`/`onNavigate`, no
  `navigating`/`page`/`updated` stores.
* No server `fetch` wrapper with cookie/auth forwarding in `load`.

## 3. Forms/Actions (open)

* Verbs + `?q` + `303` no-JS + `fail`-lite (`isFail`) + `deserialize`
  are DONE (see `forms.md`).
* No named `actions{save,delete}` namespace (verbs + `?q` cover it —
  explicitly out, not planned).
* No `use:enhance`/`applyAction` progressive-enhancement cycle
  (needs client router).

## 4. Layouts/Errors/Hooks (open)

* Single global `+error.svelte` by design — no per-directory
  inheritance (explicitly out, not planned).
* No `+layout(.server).ts` data merging (the `+route.v` `@[load]`
  cascade + typed parent covers position; SvelteKit-shaped merging is
  not planned). No layout reset via groups beyond the URL strip (done).
* Subtree `@[before]`/`@[after]` + root `+route.v` as global head are
  DONE (see `rpc.md` attributes table). What remains: lifecycle file
  (`@[startup]`/`@[cron]`/`@[queue]`/`@[reroute]` → `specs/moar.md`).
  No `handle`/`handleFetch`/`handleError` (explicitly out);
  `transformPageChunk` = `@[after]` string rewrite (no chunks exist);
  `init` = `@[startup]`.

## 5. Rendering modes (open)

* Per-route `ssr=false`-lite: manifest flag → `Hand` skips QJS/sidecar,
  serves SPA shell. No prerendered `.html`, no `csr=false` islands.
* No `entries`/`prerender-crawl`, no SSG/ISR, no
  `adapter-static`/`node`/`auto`/`edge`.
* SSR stays runtime-only (embedded QuickJS / sidecar, 50ms/16MB
  fallback to SPA shell) — never emits prerendered `.html` files.
* No service-worker, no offline story, no snapshot export.

## 6. Platform DX (open)

* `#app/paths` + `#app/environment` virtual stubs: DONE. `#app/forms`:
  DONE (`deserialize` only). No `$app/stores`, `$app/state`,
  `$app/navigation` (need client router).
* No `$env/static/private` / `dynamic/private` — physical
  `#lib/backend` / `*_backend.v` instead (built, see `rpc.md`).
* `CSP`/`CSRF`/`methodOverride`/`version` knobs: DONE.
* No `svelte-check` `$types{Params,ServerLoad,Actions}` generics —
  flat `types/routes/*.d.ts{Struct,Result,fn(args)}` + `RouteId`/`Params`
  instead (built, see `types.md`).

## First external demand (migrating apps: micro, emw)

### P0 — cannot migrate without (design + build)

A. Binary/response control. Verbs return string|struct, uploads keep
   filenames only. Both apps serve PDFs, images, ZIPs,
   manifest.webmanifest, sitemap.xml, sw.js, PWA icons, auth cookies.
   Minimum viable: `@[after]` grows to
   `(req,code,body)->(code,body,headers)` + a bytes return kind
   (`[]u8` → base64 already projects as string; need Content-Type +
   Content-Disposition passthrough), and `SwelteRequest.files`
   optionally retains bytes (size knob, default discard).
B. Global hooks. `@[before]`/`@[after]` subtree-only is DONE for
   middleware; both apps ALSO need the lifecycle file (auth session
   resolution on every request, Sentry wrapping, security headers +
   CSP nonce, locale cookies, module/subdomain gating, favicon
   short-circuit) → `specs/moar.md`.
C. Reroute / host-based routing → `@[reroute]` in `specs/moar.md`.
D. Route groups + `[[slug]]` + matchers: DONE (groups/optional/matcher
   builtins; custom matchers open).

### P1 — parity, workaroundable briefly

`locals` + cookie helpers, CSP/CSRF/methodOverride, HEAD/OPTIONS,
trailingSlash, `Params` types, `#app/paths|environment`, version
stamping: all DONE (see `config.md`).

`+server.ts`-style raw `Response` escape hatch for webhook signature
verification (raw bodies + HMAC — Resend/EnableBanking/Stripe need
raw bytes JSON/form dispatch mangles): raw-body mode per file or a
tiny TS sidecar. OPEN.

### P2 — later, live without

Client router (goto/invalidate/depends/beforeNavigate), streaming
`<await>`, `parent()`, server fetch wrapper, per-route
ssr/csr/prerender/entries, SSG/ISR/adapters, `snapshot` export.
None block a server-rendered migration.

