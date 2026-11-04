# Swelte: parity audit + next steps

TODO: Document (in .md and in examples/docs-site)

## 1. Where you are (built)

`coming-from-sveltekit.md` + `example.md` prove: routing/groups/dynamics/`[...rest]`/`[[slug]]`/matchers, `+route.svelte` nesting, `@[load]` cascade + universal `+page.ts`, verbs+`?q` + `fail`-lite + `deserialize` + `use:enhance`/`applyAction`, `@[get|rpc|sse]` + `SwelteResponse`, `locals`+cookies, `trailingSlash/base/assets/csp/csrf/methodOverride/version`, `ssr=false`-lite, `HEAD/OPTIONS`, SSR QJS + budgets, SSG `entries: off|static|all` + `entries.ts`, ISR-headers, SW opt-in, `offline.fallback`, `--target static|node|edge`, `swelte export`, contract snapshot, `startup/reroute/cron`, `goto/preloadData/pushState/before|after|onNavigate/depends/invalidate/invalidateAll/page/navigating/updated`.

`cron` is already beyond SvelteKit (`@[cron('60s')]`, `spawn+sleep` loop).

## 2. Missed equivalence (SvelteKit can, Swelte can't yet)

Ordered by user pain:

### P0 — close these — DONE (verified, 215/215 at the time; P1 batch now 219/219)

All five shipped. `per-page-prerender.md` header already says
`IMPLEMENTED (P0 item 1)`. `coming-from-sveltekit.md` + `docs/rpc.md` +
`docs/config.md` document the behavior; `route-helpers.test.ts` +
`sdk-errors.test.ts` pin it. **E2E: `examples/tests` parity battery**
(`tests/e2e/battery.js` `defineParityContract` + `defineParitySsrContract`,
preview direct + CLI; dispatch-level also vs the dev backend).

1. **Per-page `prerender` (`true|false|'auto'`)**: DONE. Carrier is
   `export const prerender` in the sibling `.ts` (leaf `+page.ts` or
   wrapper `+route.ts`) — `readPrerenderHint`/`assertPrerenderHint`
   (`vite/routes.ts`), carried on `SvelteRouteEntry.prerender`, surfaced in
   `ssr-manifest.json`. Precedence leaf > nearest explicit wrapper >
   global `prerender.entries`. `false` excludes even under global cover;
   `true`/`'auto'` includes even under `'off'`. Strict-parity gap kept by
   design: SvelteKit `true` excludes the route from the dynamic manifest;
   Swelte keeps all dispatch (single binary), so `auto ≡ true` for the
   crawl (distinct spelling kept for familiarity).
2. **`load` cookies/headers/status**: DONE. `SwelteLoadResult{body,status,
   headers,cookies}` envelope. Plain `!T` loads wrapped
   (`SwelteLoadResult{body: json.encode(frag)}`, 200 default);
   `!SwelteLoadResult` loads pass through unwrapped (full control).
   `validateLoadFn` rejects `SwelteResponse`/`[]u8` returns with file+line.
   `server.v:swelte_page_props → before_request` applies the envelope to
   HTML navigations (Set-Cookie + custom headers + non-200 → `+error` /
   redirect path); the JSON branch (client-router fetch) reads the same fields.
3. **Typed errors with status**: DONE. V `SwelteError{status,message}` +
   `swelte_error(status,msg)` (clamps `<400 → 500`), thrown from
   verb/`@[load]` → `+error` props with the status. Plain string throws
   keep the 400 default. Redirects stay `SwelteResponse` (verbs) / envelope
   `3xx+Location` (loads). TS `swelteError(status,msg)` + `isRedirect(e)`
   (`sdk.ts`, re-exported via `$app/navigation`).
4. **`updated` store**: DONE (stale ref `sdk.ts:504` removed — now
   `sdk.ts:~639`). Server stamps `X-Swelte-Version` on every response
   (baked from `package.json` version, `SWELTE_VERSION` wins).
   `checkUpdated()` — `HEAD /` (same-origin, no body) with one same-origin
   `GET /` fallback on 404/405 + meta-tag seed — flips `updated` only on
   header change/mismatch. `handleFetch` hooks bypassed via captured
   `origFetch` (no recursion).
5. **`handleFetch`**: DONE. `handleFetch(hook)`/`clearFetchHooks()`
   (`sdk.ts:~137`): sees/rewrites every stub fetch
   (`{base,fn,kind,args,qualifier,init}` → rewritten `RequestInit` or void);
   throw surfaces as the stub error. Re-exported from `$app/navigation`.

### P1 — SvelteKit remainder — DONE (verified, 219/219 tests pass)

Router + render + hooks batch. `coming-from-sveltekit.md` + `config.md`
document the behavior; `ssr-manifest.test.ts` + `sdk-errors.test.ts` +
`generate-errors.test.ts` + `codegen-shape.test.ts` pin it. **E2E: same
`examples/tests` parity battery** (layout cut, `csr` manifest flag,
`@`-error sanitize, reroute, per-route limits, preload link options).

6. **`csr=false`**: DONE (lite). `export const csr = false` in the
   sibling `.ts` (leaf or `+route.ts` wrapper) renders SSR HTML only —
   client mount/hydrate is a deliberate no-op (`swelte_no_csr()` predicate
   in `server_gen.v` + `csr: false` on the `routes.js` entry;
   `ssr-manifest.json` surfaces `csr` per route). Independent corner from
   `ssr=false` (which is no-SSR + JS-only). Default `true` everywhere.
7. **`handleError`**: DONE (lite). `@[error](message string, status int)
   string` in `src/app.v` (zero/one fn, no qualifier — same shape as
   `@[startup]`/`@[reroute]`): return `''` to keep the message or a
   sanitized replacement. `generate()` replaces the harness default
   `swelte_sanitize_error()`; applied to JSON error bodies + HTML error
   pages before send (never leak internals). Validation: file+line build
   errors for wrong params/return/arity/duplicates.
8. **Shallow routing**: DONE (lite). `page.state: Record<string,unknown>`
   on `SweltePageState` (never sent to the server, survives `popstate`);
   `replaceState(url, { 'page-state' })` alongside `pushState` (history
   entry only — no reload, no load re-run); `captureSnapshot(fn)` /
   `restoreSnapshot(fn)` manual hooks (SvelteKit `export const snapshot`
   without the compiler transform — registered capturers merge per-key,
   captured on `goto`, restored on `popstate` traversal).
9. **`preloadCode` + `data-sveltekit-*` link options**: DONE.
   `preloadCode(url)` warms the route's chunk loaders (no DOM write,
   pairs with `preloadData` for hover prefetch); click + hover honor
   `data-sveltekit-preload-data/preload-code/reload/noscroll/noreplace`
   (with `data-swelte-*` aliases for the reload opt-out). `goto` takes
   `{ noPreload?, noPreloadCode? }`.
10. **Layout composition (`export const layout`)**: DONE.
    `admin/login/+page.ts` with `layout = false` renders outside the
    `+route.svelte` chain (same URL rules as a leaf — plain-named
    `about.svelte` reads `about.ts` identically); `'admin'` keeps wrappers
    down to `admin`; `true` pins the full chain back on under a bare
    subtree. `routes.js` cuts the chain; `ssr-manifest.json` surfaces
    `layout` per route. Leaf wins, else nearest explicit wrapper — so a
    wrapper's `false` bares a whole subtree (SvelteKit `+layout@` ergo),
    something the old filename carrier could never express. Backend data
    channels work under cuts (ordinary `+page.v` dispatch — the old
    `+page@.svelte` + `.v` combo emitted a bogus `/admin/users/+page@`
    route). Composition-only by design: skipped wrappers' `@[load]` /
    `@[before]` / `@[after]` still run (`+route.v` doubles as middleware).
    No `@` in filenames: stale `+page@.svelte` / `about@.svelte` files fail
    the build with the rename + one-line fix.
11. **`$app/forms`, `$env/*`, `$service-worker`, `$app/server`**: LOCKED
    NON-GOALS (documented in `coming-from-sveltekit.md`). `#app/paths` +
    `#app/environment` + `SWELTE_*` stay the surface; typed
    `$env/static/*` projection stays unbuilt by choice.
12. **Per-route `config` (regions/runtime)**: DONE (lite, single-binary).
    `export const limits = { rate, rateWindowMs, timeoutMs, bodyLimit }`
    in the sibling `.ts` (leaf wins, else nearest explicit wrapper;
    positive ints, file+line build error). Longest-prefix match in `Hand`
    overrides the four global hardening knobs per route; no
    regions/runtime (one artifact, one deploy target).

### P2 — polish — DONE (verified, 225/225 tests pass)

All three closed. Streaming SSR stays a locked non-goal (QJS sync).
**E2E: same `examples/tests` parity battery** (serializedHeaders
allowlist, async paginated `entries.ts`, per-page prerender dist
artifacts: `true` written even under `entries:'off'`, `false` excluded).

1. **`entries()` async/paginated**: DONE. `collectPrerenderEntries`
   already `await`s the sibling `entries.ts` export (`await (fn as
   () => unknown)()`), so sync and `async` both work — including
   paginated fetch loops inside the fn (runs in Node at generate time).
   Bad shape (non-array, throw) stays a file+line build error. Pinned by
   the `P2: collectPrerenderEntries awaits async entries()` test
   (`route-helpers.test.ts`) + docs in `config.md` /
   `coming-from-sveltekit.md`.
2. **`filterSerializedResponseHeaders`-style control**: DONE (lite).
   `export const serializedHeaders = [...]` in the sibling `.ts` (leaf
   wins, else the nearest wrapper's `+route.ts` — same dir first, then
   up; same carrier as `ssr`/`csr`/`limits`; a `: string[]` type
   annotation is tolerated) allowlists which `SwelteLoadResult.headers`
   land on the HTML navigation. Absent = no filter (all pass — today's
   behavior, back-compat); explicit list (incl. `[]` = keep nothing)
   keeps only those names (exact match, case-insensitive at runtime).
   `Set-Cookie` stays on its own path and `Location` always passes, so
   a load-side 3xx redirect keeps its target even when the allowlist
   omits it. Surfaced in `ssr-manifest.json`; enforced in `Hand` via the
   generated `swelte_serialized_headers()` longest-prefix table
   (`assertSerializedHeadersHint` rejects malformed hints — including a
   typed declaration that isn't a string array — with file+line).
   Dynamic rows match through the shared `swelte_route_hit()` predicate
   (`swelte_match_route`), so `/users/[id]` fires for `/users/42`
   instead of silently never matching; per-route `limits` uses the same
   predicate. `transformPageChunk`-style body rewrite needs no new
   knob: `@[after]` already rewrites the whole `SwelteResponse`.
3. **Streaming SSR**: locked non-goal (QJS sync). Keep.
