# micro migration inventory

Updated: 2026-11-08. Shared execution status lives in the
[native dogfooding roadmap](dogfood-roadmap.md). This document retains
micro-specific scope; it is no longer a second framework implementation plan.

The original inventory grouped application ports with framework features and
treated native dependencies as missing implementations. Reuse V database,
HTTP, crypto and other native facilities before introducing Swelte APIs.
Production migration uses native code without a Node backend/sidecar. Pure
browser JS libraries can remain JS; WASM is an option, not a migration rule.

## Shared requirements

| Original area | Shared roadmap / qualification |
|---|---|
| PostgreSQL and startup migrations | DF-08. V already has PostgreSQL ORM, pooling, pinned connections and transactions. Integrate existing schema/history; do not blindly replace it with `_swelte_migrations`. |
| Realtime SSE / WS | DF-04, DF-10, DF-11. Existing rooms/GET SSE do not establish guarded POST streams or disconnect cleanup. |
| Binary bodies and uploads | DF-04, DF-07, DF-16. Transport exists; prove actual multipart/binary flows and configured limits. |
| i18n / locale / theme / subdomains / PWA | DF-02, DF-05, DF-06, DF-14. Reuse Paraglide/browser assets; the app owns locale/host policy and configuration. No V catalogue generator is established as necessary. |
| Mail / signed webhooks / HTTP integrations | DF-08, DF-16. Reuse native HTTP/crypto and preserve application idempotency. |
| Observability | DF-09, DF-13, DF-15. Reporting hooks/context belong in the shared lifecycle; provider adapters can live in ai1. |
| Validation / parsing libraries | DF-16, DF-20. Audit reachable code and runtime requirements. Browser-safe TS reuse and native backend ports are separate decisions. |

## Additional micro scope

These requirements came from the original inventory and still need a fresh
call-site and behavior audit before implementation estimates are accepted.

| Area | Application requirements | Tracker |
|---|---|---|
| Authentication/session | Existing better-auth consumers, auth catch-all, user/session context, required password/provider behavior, DB-first locale, module subdomains and cookie/cache policy. EMV's salt gate does not satisfy this scope. | DF-18 |
| Durable financial jobs | `registerBillQueue`, `scheduleBillSweep`, bill workers, TTL expiry, capture concurrency and retake races. Preserve durable effects and restart/worker coordination; ticks alone are insufficient. | DF-19 |
| Payments and banking | Stripe top-ups/signatures and Enable Banking redirect/auth/payment flows; retain event idempotency and original raw-body verification. | DF-20 |
| Documents and media | Enabled bill image/source/PDF flows, structures ZIP exports, QR generation, PDF ingestion, image processing and storage. Select native libraries/bindings for actual capabilities rather than asserting no equivalent exists. | DF-20 |

App-specific queries, migrations, workers, auth policy and integrations stay
in micro or reusable native libraries. Swelte owns the transport/lifecycle
contracts they need. Financial workflow acceptance is required before those
flows migrate; it is not optional post-release polish.
