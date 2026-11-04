# Swelte: parity audit + next steps

Swelte is ~85% equivalent to SvelteKit today. The one open spec is `docs/specs/per-page-prerender.md`. Below is what that doc misses, and what you can do SvelteKit never did.

## 1. Where you are (built)

`coming-from-sveltekit.md` + `example.md` prove: routing/groups/dynamics/`[...rest]`/`[[slug]]`/matchers, `+route.svelte` nesting, `@[load]` cascade + universal `+page.ts`, verbs+`?q` + `fail`-lite + `deserialize` + `use:enhance`/`applyAction`, `@[get|rpc|sse]` + `SwelteResponse`, `locals`+cookies, `trailingSlash/base/assets/csp/csrf/methodOverride/version`, `ssr=false`-lite, `HEAD/OPTIONS`, SSR QJS + budgets, SSG `entries: off|static|all` + `entries.ts`, ISR-headers, SW opt-in, `offline.fallback`, `--target static|node|edge`, `swelte export`, contract snapshot, `startup/reroute/cron`, `goto/preloadData/pushState/before|after|onNavigate/depends/invalidate/invalidateAll/page/navigating/updated`.

`cron` is already beyond SvelteKit (`@[cron('60s')]`, `spawn+sleep` loop).

## 2. Missed equivalence (SvelteKit can, Swelte can't yet)

Ordered by user pain:

### P0 — close these
1. **Per-page `prerender` (`true|false|'auto'`)**: only global `prerender.entries` exists. Spec is open. Needed: `export const prerender` in `+page.ts/+route.ts`, leaf > wrapper > global, `false` excludes from crawl, `'auto'` = prerender + keep dispatch (currently no-op, manifest keeps all).
2. **`load` can't set headers/cookies/status**: SvelteKit `load` returns `{cookies.set(), setHeaders()}`. Swelte `@[load]` returns value-only. Add `mut res SwelteResponse`-style out-param or allow `SwelteResponse`-wrapped load.
3. **Typed errors with status**: `!T` throw → always `400 err.msg()`. No `error(404|redirect)` status preservation. Need `SwelteError{status, body}` convention + `isRedirect` helper.
4. **`updated` store never fires**: stub exists (`sdk.ts:504` — "no version check yet"). Wire `X-Swelte-Version` poll to set it.
5. **`handleFetch`**: no client fetch interception. SvelteKit `hooks.client/handleFetch` for auth headers/retries. Add `beforeFetch` hook in `sdk.ts`/`__swelteFetch`.

### P1 — SvelteKit remainder
6. **`csr=false` / islands**: explicitly `No csr=false islands`. Decide: keep non-goal or add `export const csr=false` → no-JS HTML only.
7. **`handleError`**: single global `+error.svelte`, no `handleError` hook returning `App.Error`. Add `@[error]` in `app.v`?
8. **Shallow routing**: `pushState(url,state)` exists, but no `page.state` + `replaceState` + snapshot. SvelteKit `pushState` + `export const snapshot` + `page.state`. Add `state` to `SweltePageState`.
9. **`preloadCode` + `data-sveltekit-*` link options**: `preloadData` exists, no `preloadCode`, no `data-sveltekit-preload-data/preload-code/reload/noscroll/noreplace`.
10. **Layout reset (`+page@.html`)**: `(group)` stripping done, but no breaking out of `+route.svelte` chain.
11. **`$app/forms`, `$env/*`, `$service-worker`, `$app/server`**: deliberate gaps (`#app/*` + `SWELTE_*` instead). Either document as locked non-goals or project typed `$env/static/*` from `SWELTE_*`.
12. **Per-route `config` (regions/runtime)**: Swelte `target` is global packaging-only. SvelteKit merges `export const config` per-layout. If you stay single-binary, at least allow per-route `cache/timeout/rateLimit`.

### P2 — polish
* `entries()` async/paginated (currently static list).
* `transformPageChunk` = `@[after]` string rewrite exists, but no `filterSerializedResponseHeaders`-style control.
* Streaming SSR: locked non-goal (QJS sync). Keep.

## 3. Beyond SvelteKit (where Swelte can win)

SvelteKit couldn't / didn't:

1. **Cron → jobs**: today best-effort `spawn+sleep`, no watchdog, single-instance. Next: persistent tick log, missed-tick catchup, `retry(n)` + dead-letter, `swelte jobs list`.
2. **Embedded SQLite/KV**: V binary + volume = zero-ops DB. `src/lib/backend/db.v` helper + `swelte migrate` > SvelteKit needing Neon/PlanetScale.
3. **First-class `@[ws]`**: SvelteKit has no WS primitive. V `veb` + Svelte runes = typed socket Rooms/broadcast to pair with existing `@[sse]` list/emit modes.
4. **SSE broadcast primitive**: add channels (`emit('room', msg)`) — currently per-request emit only.
5. **ISR → SWR background regen**: today headers-only (`s-maxage+X-Swelte-Revalidate`). V can re-render on timer + swap `dist/*.html` atomically.
6. **V-native image pipeline**: `enhanced-img` equivalent at `build` time (resize/WebP in V, no Sharp).
7. **Offline outbox**: SW currently network-only for API. Add background-sync queue (`POST` while offline → replay) — LiveView can't, SvelteKit doesn't.
8. **Hardening as config**: `BODY_LIMIT/RATE_LIMIT/HANDLER_TIMEOUT` already built-in (SvelteKit needs middleware). Expose per-route: `export const limits = {rate, timeout}`.
9. **Agent-native**: `swelte check --format json` + MCP + contract snapshot already ahead. Next: `swelte studio` (route graph UI from `list_routes`) + `explain_bytecode_error` for prod traces.

## Suggested order

1. Per-page `prerender` (spec ready) + `load` cookies/headers + typed errors — closes migration blockers.
2. `updated` + `handleFetch` + `handleError(@[error])` — closes hooks gap.
3. Pick one differentiator: SQLite helper **or** `@[ws]` — both impossible in JS without infra, trivial in a binary.

Want me to turn `per-page-prerender.md` + items 2-3 into implementable specs (codegen-shape + `collectPrerenderEntries` + `server_gen.v` changes)?
