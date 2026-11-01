---
name: swelte-sveltekit-delta
description: Swelte vs SvelteKit migration gaps — what is built, what is open (P0/P1/P2), and workarounds. Use when porting a SvelteKit app, checking feature parity, or planning migration work.
---

# Swelte ↔ SvelteKit Delta

> ⚠️ SPEC-DEPENDENT SKILL — this skill tracks `docs/specs/sveltekit.md` and `docs/specs/moar.md`. Re-read both specs on every use; refresh this skill whenever they change. See `docs/specs/skills.md` for the maintenance contract.

## Built (§1 all 9 + §2 items 10/11/12/14, done)

Route groups `(group)` stripped from URL · optional `[[slug]]` · `trailingSlash: 'always'|'never'|'ignore'` (env `SWELTE_TRAILING_SLASH` wins, server 301s) · per-route `Params` types (`RouteId` + `Params` atop every `types/routes/*.d.ts`) · `#app/paths` + `#app/environment` virtual stubs · CSP + CSRF + `methodOverride` knobs · `SwelteRequest.locals` + `swelte_cookie_get/set/delete` helpers · `HEAD` via the `GET` arm + CORS preflight · `version` + `name` stamping (`X-Swelte-Version`) · param matchers `[id=integer]` (digits both sides, `Params: number`) · `fail`-lite (`isFail`) · `deserialize` · root `+route.v` as global head (verified).

Additive only: none of this changes the locked invariants (single global `+error.svelte`, engine-agnostic core, `Hand`+dispatcher ownership, server-only `@[load]`, `#routes/` fetch vs `#lib/` WASM split, single-artifact `dist/server`, SPA-first proxy).

## P0 — cannot migrate without (design + build)

- **Binary/response control.** Verbs return `string|struct` today; no header/cookie/stream control. Needs: `@[after]` growing to `(req,code,body)->(code,body,headers)` + a bytes kind + optional `files` byte retention.
- **Global hooks.** Subtree `@[before]/@[after]` + root global head are DONE. Still needs: the lifecycle file (auth, Sentry, CSP nonce, locale, favicon) → `specs/moar.md`.
- **Reroute / host routing.** Needs: `@[reroute]` in the lifecycle file (e.g. `bills.* → /bills`, `/arb2b/* → /market/*`).
- **Groups + `[[slug]]` + matchers.** Groups/`[[slug]]`/matcher builtins are DONE; custom matchers via central `src/matchers.v` still open.

## P1 — workaroundable briefly

`+server.ts`-style raw-body escape hatch for webhook HMAC verification (raw-body mode per file or a tiny TS sidecar). (`fail`-lite + `deserialize` are DONE.)

## P2 — live without

Client router (`goto/invalidate/beforeNavigate`, `$app/*` stores), streaming `<await>`, server `fetch` wrapper, per-route `ssr/csr/prerender`, SSG/ISR/adapters, service-worker/snapshot, `$types` generics (Swelte generates flat `types/routes/*.d.ts` instead).

## Open (single list — §2.13 + moar)

Per-route `ssr=false`-lite (manifest flag → `Hand` skips renderer, SPA shell).

Plus `docs/specs/moar.md`: lifecycle file (`@[startup]`, `@[cron]`, `@[queue]`, `@[reroute]`) — pure V, no TS sidecar, no SvelteKit `handle/handleFetch/handleError` surface.

## Sources

- `docs/specs/sveltekit.md` — the delta itself (VOLATILE: items move done→built)
- `docs/specs/moar.md` — server lifecycle (VOLATILE: filename + `@[queue]` transport TBD)
- `docs/versus.md` — positioning (stable)
