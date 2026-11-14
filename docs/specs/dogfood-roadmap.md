# Native application dogfooding roadmap

Updated: 2026-11-14.

This is the execution and progress tracker for Swelte work discovered by EMV
(the native counterpart of EMW) and micro. Shared requirements live here;
application and library implementations stay with their owners. Existing demo
coverage does not establish production migration readiness.

Inputs: `emedware/apps/emv/docs/specs/swelte-requirements.md` (SW-01–SW-08),
its ai1/application companion specifications, the [micro inventory](micro.md),
and [longer-term ideas](future.md). Paths starting with `emedware/` refer to
the sibling repository. This roadmap owns shared execution status; application
specs retain their behavioral requirements.

## Scope and ownership

| Owner | Work |
|---|---|
| Swelte core / SSR adapter | Guarded request lifecycle, page data/state, SSR, hydration, navigation, forms, transport and diagnostics |
| Optional integration / recipe | PostgreSQL startup/sharing, migration integration and native dependency packaging; reuse V facilities |
| ai1 | Native providers, runner/registries/waits, shared wire contracts, RunStore, reusable integrations and UI package boundaries |
| EMV | Domain SQL, existing schema/migration history, salt authorization, URLs, locale/SEO policy, workflows, tools and deployment |
| micro | Its session/auth requirements, durable financial workflows, payments and application migration |

Production runs native V with embedded QuickJS SSR, without a Node runtime or
sidecar. Browser JS and build-time Node tooling remain supported. PostgreSQL,
provider APIs, native libraries and Chromium are declared dependencies where
used. Browser-safe TS libraries need not be ported to WASM.

## Requirement traceability

| EMV requirement | Tasks |
|---|---|
| SW-01 — State/data | DF-02, DF-05, DF-06 |
| SW-02 — Forms/refresh | DF-03, DF-05, DF-07 |
| SW-03 — PostgreSQL | DF-08 |
| SW-04 — Application SSR | DF-01, DF-06, DF-09, DF-17 |
| SW-05 — Streaming/cancellation | DF-10, DF-11, DF-12 |
| SW-06 — Middleware/startup | DF-04, DF-08, DF-13 |
| SW-07 — npm V libraries | DF-01 |
| SW-08 — Prerender/observability | DF-06, DF-09, DF-14, DF-15, DF-17 |

DF-16 retains EMV's remaining integration gate. DF-18–DF-20 retain micro's
additional requirements; the original micro areas are mapped in [micro.md](micro.md).

## Progress rules

- `pending`: required outcome not delivered.
- `active`: started; record the current step and remaining acceptance.
- `verify`: implementation exists, but representative acceptance is unproven.
- `done`: implementation, regression fixture and documented contract complete;
  cite validation evidence.
- `blocked`: name the concrete dependency and owner.

Update status, evidence and next step in the same change that advances a task.
A gate completes only when its tasks and application acceptance pass. Temporary
probes establish findings, not completed integration. Keep task IDs stable in
fixes and downstream reports. Do not duplicate this checklist in application specs.

## Baseline: audit completed, delivery gates open

| Existing capability | Evidence / limit |
|---|---|
| V PostgreSQL | Bundled toolchain contains ORM, pooled `pg.DB`, parameterized execution, pinned connections and transactions. The disposable native integration fixture now validates these paths; actual application migration history/deployment remains open. |
| Native SSR | Embedded QuickJS and per-render runtime/context exist. Application composition, state and fallback behavior need fixes/validation. |
| npm V modules | Current source materializes universal/server exports; server entries skip browser RPC projection. DF-01 now proves a packed ai1-shaped dependency; full ai1 remains DF-09/12. Source validation does not imply a published release. |
| HTTP primitives | Cookies, structured/binary responses, raw bodies, uploads, loads and middleware exist. Cross-path behavior is incomplete. |
| Realtime / jobs | GET SSE, WS rooms, POST byte streams and cron ticks exist. Fixtures cover guarded metadata and stream disconnect/idle cleanup; run/subscriber lifetimes and shutdown remain open. Ticks do not establish durable queue semantics. |

2026-11-08 validation: compiled current core and SSR test targets; 27 focused
SDK/npm V tests and 5 SSR composition tests passed. Temporary generated-bundle
probes reproduced missing nested head output, missing wrapper load props,
`$app/state` rendering failure and cancellation without native submit prevention.
The bundle probes ran under Node, not native QuickJS E2E. No live PostgreSQL,
provider, browser hydration or concurrency acceptance was run.

## Gate 0 — Contracts and installed-package feasibility

Do this before a large native ai1 port. Choose explicit Swelte contracts and an
opt-in adapter where useful; a full SvelteKit compatibility project is not required.

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-00 | done | Review requirements against source; distinguish framework defects, existing V integration and downstream ports. Evidence recorded above. |
| DF-01 | done | [Installed-package fixture](../../fixtures/dogfood/README.md) packs/installs native interfaces, callbacks/channels, nested V, SQLite/crypto and Svelte UI. `npm run test:dogfood` checks TS declarations, rejects browser server imports, builds browser assets and serves native JSON/QuickJS HTML with empty runtime PATH. Fixed SSR resolution of installed Svelte/TS/runes modules. Tested versions below; Vite 6 retained for pilot. |
| DF-02 | done | [Lifecycle contract](page-lifecycle-contract.md) specifies opt-in Kit props/state adaptation, request-local SSR, per-level data, safe hydration state, explicit load-header protocol alongside ordinary JSON, refresh and error/redirect handling. Implementation remains DF-04–09. |
| DF-03 | done | [Action contract](page-lifecycle-contract.md#action-selection) selects named `?/action` mode without reserving search `q`; legacy applications retain parsing unless configured/migrated. Defines no-JS, cross-page and query-retention behavior. Parser/adapter implementation remains DF-07. |

Gate acceptance: the installed native/UI consumer compiles, and lifecycle/action
contracts are concrete enough to implement and test together. This is a small
feasibility fixture, not a port of the full ai1 backend.

Gate 0 accepted, 2026-11-08. Tested source packages `@swelte/core` and
`@swelte/ssr-qjs` 0.1.4, fixture 0.0.0, V `0.5.2 7647ce1`, Svelte 5.57.3,
Vite 6.4.5 and TypeScript 5.9.3 on Linux. Node 22.14.0 is build/test tooling
only. This is not a Vite 8 compatibility claim or a full application migration.
SQLite validates native linking only; PostgreSQL headers/integration remain
DF-08. The full SSR suite passed 51 tests, including installed package exports,
nested components, TS/runes modules, unresolved-import failures and source guards.
All 252 core tests passed with Node 22's `--experimental-strip-types` flag.
Without it, the unchanged core suite has two `.ts`/`.mts` dynamic-import failures
(legacy config and async prerender entries); this is a build/test tooling
constraint, not a native runtime dependency.

## Gate 1 — Guarded, hydrated page and PostgreSQL mutation

First application slice: root wrapper, translated landing page and `/threads`
read/mutation. Authorization and metadata belong here even though parts appeared
under P1 in the original requirements.

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-04 | verify | Shared before/load/after lifecycle covers UI HTML/navigation, mutations, binary responses and SSE/WS takeover. Native fixture proves middleware locals, redirects, headers/multiple cookies, denied mutations without side effects and guarded binary bytes; cross-origin writes are rejected before handlers. Remaining: actual application salt authorization acceptance. |
| DF-05 | verify | Versioned loads, hydration, reactive state and awaited refresh update mounted props. Browser fixture proves query/history/hash, Svelte-only inherited loads, tagged invalidation, stale suppression, dynamic route identity/decoded params and direct dynamic SSR hydration. Refresh cannot supersede pending navigation, and a navigation supersedes an in-flight refresh. Native watchdog proves 504. Remaining: actual application flows and wider concurrency/stress acceptance. |
| DF-06 | verify | One SSR tree preserves nested head/context and per-level data; request-local state and root-first universal loads match browser hydration. Fixture proves exact SSR DOM retention and concurrent locale isolation. Remaining: complete native EMW locale/auth/head acceptance and representative production dependencies. |
| DF-07 | verify | Named/legacy actions, synchronous interception, aborts, callback adapter, inline failures and awaited refresh implemented. Native/browser fixtures prove no-JS 422/303, filters, component/value retention, multipart bytes, submitter overrides, cross-page isolation and error boundaries. Revision/signal checks suppress actions superseded by navigation or a newer submission, including after awaited refresh. Remaining: actual application mutations and complex multi-form/custom-callback scenarios. |
| DF-08 | verify | [Native PostgreSQL recipe](../../fixtures/postgres/README.md) reuses V pooling/parameters/transactions; app-local backend staging and startup imports are wired. Disposable real DB passes typed UUID/UTC/JSONB/decimal/null rows, rollback, migration replay/checksum/failure, lock contention/cleanup and failed startup before dependent work. Remaining: reconcile actual application migration history and validate deployment dependencies there. No new ORM/plugin required. |
| DF-09 | active | Sanitized render 500/initial error state and strict SSR/hydration implemented. Native diagnostics distinguish timeout, memory, output, compile/load and exception failures. C tests prove actual timeout/OOM/exception codes and concurrent bundle-cache isolation; fixed an eviction race. HTTP fixture proves strict render/timeout/output 500, head growth/recovery and no silent head truncation. Browser corruption test proves strict hydration cannot silently remount. Remaining: application reporting/original-error diagnostic policy and full ai1/Markdown/Paraglide/Tailwind dependencies. |

Gate acceptance in EMV: direct HTML has correct locale, head and status before
JS; hydration retains data; `/threads?filter=unread&q=example` supports read/note/
status mutations without losing filters; failures stay inline; back/forward load
the correct query. No-JS forms work. Unauthorized variants cannot execute
protected work. PostgreSQL tests use an isolated real database.

Implementation locations (the original defects below are now addressed in the fixture):

- [Client entry](../../engine/core/templates/client/main.ts): initial-envelope hydration.
- [Router](../../engine/core/src/vite/client-router.ts): navigation load protocol,
  per-level props, universal transforms and history.
- [SDK](../../engine/core/src/sdk.ts): state, forms, invalidation and router bridge.
- [Harness](../../engine/core/templates/harness/server.v): guarded page requests,
  action selection, SSR status and native stream transport.
- [Server generation](../../engine/core/src/vite/server-gen.ts): middleware,
  load cascades and transport accessors.
- [SSR composition](../../engine/ssr-qjs/src/ssr.ts): installed dependencies,
  request-local state, nested tree/head and error rendering.

## Gate 2 — Native ai1 streaming application

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-10 | verify | Native `swelte_stream(headers, producer)` sends bytes unchanged from POST handlers. Native fixture passes body/header handling, run ID, named SSE frames, first event before completion, fragmented UTF-8 and pre/post-start failure behavior. Remaining: integrate ai1's actual provider using existing V incremental HTTPS callbacks. |
| DF-11 | verify | Bounded buffering, cancellation and enforced socket timeouts pass stalled-reader tests. Heartbeats detect idle SSE disconnects; a shared registry releases repeated SSE/WS subscriptions. Shutdown wakes socket I/O and drains producers/writers. Native tests cover room cleanup, active shutdown and normal WS completion. Remaining: ai1-owned run/subscriber lifetimes and representative concurrency stress. |
| DF-12 | pending | Integrate ai1-owned native provider, runner and PostgreSQL RunStore through EMV routes. Run shared scenarios for chat, replay/live handoff, stop/steer races, human waits and tools against the unchanged browser protocol. Track ports in ai1/EMV and framework defects here. |

Gate acceptance: first events arrive before provider completion; reconnect/replay,
persistence and cleanup follow the documented lifetime policy. No EMW/Node proxy
or hosted ai1 backend.

## Gate 3 — Operational readiness and complete EMV flows

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-13 | verify | [Lifecycle contract](../../docs/lifecycle.md) wires the bundled V server's graceful shutdown. Fixed plugin jobs starting before app startup and explicit startup error returns. SIGTERM/INT stop admission, interrupt streams, drain HTTP/detached loads/verbs and tracked cron work, then run a bounded `@[shutdown]` hook. Native tests pass repeated signals, active streams/rooms, timed-out loads, jobs, and work/hook deadlines. PostgreSQL recipe closes its pool after drain. Remaining: application-owned workers/resources and deployment shutdown verification. |
| DF-14 | done | Native fixture validates translated grouped dynamic entries, dynamic `/`, inherited opt-outs, canonical/head content and error status. Fixed physical group ancestry/sibling lookup and encoded params; crawler rejects redirects, errors and shells, uses its own ephemeral-port child, and prunes only recorded owned artifacts. Browser hydrates real static Unicode artifacts and verifies the hosting URL. Actual application locale/SEO policy remains app-owned. |
| DF-15 | verify | Optional `@[report] (event SwelteReport)` supplies generated request IDs, path/method/status/timing and server-only native error messages for handlers, loads, streams, jobs and lifecycle. Reporter failures do not change responses. Default diagnostics omit original error text; native fixture verifies original causes reach the hook while clients/console stay sanitized. Docs distinguish built behavior from migration acceptance. Remaining: compose ai1/application reporting and JS stack policy. |
| DF-16 | pending | Verify EMV contact/webhook intake, attachments, email, push, scheduling and PDF against native library implementations. Inventory enabled capabilities; do not silently omit flows. Reuse raw/binary/HTTP/crypto facilities before proposing framework APIs. |
| DF-17 | active | Empty-PATH native production runtime is proven in fixtures. Added [repeatable measurements](../native-runtime-measurements.md) and raw Linux sample: startup/RSS, validated strict SSR HTML and POST streams at concurrency 1/8/32, declared binary/native libraries and successful shutdown. Remaining: production-optimized deployment build, actual provider/database workload, longer concurrency/cleanup stress and equivalent comparisons. Fixture measurements establish no comparative performance claim. |

## Gate 4 — Additional micro requirements

These do not block EMV's salt-gated pilot. They are required before the
corresponding micro production flows migrate.

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-18 | pending | Select/integrate native sessions/auth for micro, including required password/session/provider behavior. Reuse crypto/database capabilities; policy/schema stay with micro/ai1. EMV does not require replacement of all better-auth features. |
| DF-19 | pending | Implement durable bill/worker/sweep semantics with a native persistence/coordination adapter. Verify restart recovery, competing workers, effect idempotency, expiry and capture/retake races. Ticks and a Redis client alone do not replace BullMQ semantics. |
| DF-20 | pending | Inventory/port micro-only payments/banking and document/image/archive/QR capabilities required by enabled flows. Preserve signed raw-body checks/idempotency; select native libraries/bindings after inspecting actual use. Retain browser-safe JS validation libraries where useful. |

## Next step and session handoff

Gate 0 is complete. The coordinated lifecycle and native PostgreSQL/streaming
fixtures pass; Gates 1 and 2 remain open for the remaining acceptance above
and actual application integration. No full application/ai1 readiness is claimed.
The broader examples suite now passes: V tests use `VMODULES` to avoid V's
unquoted reconstruction of `-path`, the unified page path respects response
header allowlists, and the untyped load-error expectation is 500.
Dynamic-route and refresh/submission/navigation race fixtures now pass, as do
native SSR budget diagnostics and strict-hydration rejection. DF-04–08 are
ready for downstream application verification; Gate 1 stays open until that
slice passes against its own authorization, schema/migrations and dependencies.
Lifecycle/reporting, idle-room cleanup and translated dynamic/prerender output
now pass native fixtures. DF-14 is complete; DF-17 has a reproducible measured
fixture baseline. Next: representative application dependency/integration
acceptance, production build/deployment and longer native concurrency/cleanup
measurement using the actual provider/database workload.
Fixture coverage is not a completed downstream port.

For each session record task IDs advanced, changed contracts, fixture/test
evidence, remaining acceptance and next actionable step. Keep downstream behavior
tests in EMV/ai1/micro and minimal framework regressions in Swelte.

| Date | Progress | Validation | Next |
|---|---|---|---|
| 2026-11-08 | DF-00 done; consolidated EMV/micro overlap and ownership | 32 existing focused tests passed; temporary probes reproduced lifecycle/SSR/form defects; native E2E gates unrun | DF-01 installed-package fixture; DF-02/03 contracts |
| 2026-11-08 | DF-01–03 done; Gate 0 accepted; fixed SSR installed-package resolution and documented native integration/error-boundary limits | Packed native/UI fixture passed browser/type/native JSON/QJS checks; 51 SSR tests and 252 core tests passed (Node 22 core suite needs type-stripping flag) | DF-04–07 guarded lifecycle implementation; DF-08 PostgreSQL |
| 2026-11-13 | DF-04–11 advanced; migrated fixture to refactored library layout; native backend staging/startup imports, shared page lifecycle, forms, SSR state/tree and POST streaming implemented; PostgreSQL recipe added | 260 core and 51 SSR tests passed. `test:postgres -- --browser` passed packed-library, native empty-PATH JSON/QJS HTML, sanitized render failure, PostgreSQL, stream cleanup and real Chromium hydration/forms/history checks. PostgreSQL 18.6; disposable DB only. Broader examples suite blocked by V `-path` shell quoting. | Repair examples test runner; multipart/cross-page/action errors, tagged invalidation, navigation races; retain application gates open |
| 2026-11-13 | Resolved examples runner and header-filter regression; added awaited tagged invalidation, action error boundaries and broader browser acceptance | 262 core and 51 SSR tests passed. Full `test:examples` passed V/contract/build checks, 10 unit tests, 23 direct + 23 preview E2E cases and 17 dev/HMR cases. Final current-source `test:postgres -- --browser` passed multipart, submitter, cross-page, hash/stale navigation, action/load/universal errors, no-JS action errors, denied side effects and guarded binary bytes. Strict boot now fails rather than silently mounting after unexpected hydration failure; its negative-path coverage remains open. | DF-04 ready for application verification; DF-05/07 race/application cases and DF-09 diagnostics remain open |
| 2026-11-13 | Added navigation priority and stale-action guards, dynamic SSR/hydration coverage, native SSR reason codes/head growth and bytecode-cache eviction fix | 264 core and 51 SSR tests passed, including native C timeout/OOM/exception and eight-thread cache rotation. Full examples suite passed again. PostgreSQL/browser fixture passed strict HTTP failures/recovery and action/dynamic scenarios. Final browser-only run against the freshly built native fixture additionally passed held-refresh/navigation races, decoded dynamic hydration and deliberately corrupted strict hydration. | DF-05/07 move to application verification; DF-09 reporting/dependencies and DF-11/13 shutdown/slow-client acceptance remain open |
| 2026-11-13 | Fixed raw POST and GET SSE writes blocking indefinitely on stalled readers; preserved SSE close framing and close sockets on header failures | Complete `test:dogfood -- --browser` and `test:postgres -- --browser` passed stalled-reader cleanup, strict native SSR, database/startup and browser race/dynamic/negative-hydration acceptance. Latest core suite: 264 passed; formatting and whitespace checks clean. | DF-11 shutdown/concurrency and idle room/run lifetimes remain open; downstream application verification remains required |
| 2026-11-14 | Completed framework lifecycle/reporting slice: startup-before-plugins, fallible startup isolation, cooperative signal shutdown, bounded cleanup, tracked cron waits/work, idle/repeated room cleanup and request/error reporting. Removed long-lived stream writers' references to ephemeral request contexts. | Native browser fixture passed startup failures, active loads/jobs/streams/rooms, repeated signals, deadline exits, normal WS completion and report isolation. Core: 267 passed; plus: 17 passed. Broad examples and PostgreSQL verification are rerun as the next slices advance. | DF-11/13/15 ready for application verification; advance DF-14 and DF-17; retain actual application ports and JS reporting/dependency gates open |
| 2026-11-14 | DF-14 done: fixed grouped prerender inheritance/entries, encoded dynamic params, redirect/error/shell exclusion, isolated crawler process and owned-artifact cleanup; static artifacts hydrate with the hosting URL. DF-17 active: repeatable native runtime measurement command and scoped raw sample added. Skills document native lifecycle reuse, channel pitfalls and prerender contracts. | Core 268, SSR 51 and plus 17 tests passed. Clean-install SPA/SSR smoke passed. Complete native/browser and disposable PostgreSQL/browser suites passed lifecycle/reporting, SSR failures, translated artifacts and hydration. Full examples passed V/contract/build, 10 unit, 23 direct + 23 preview and 17 dev/HMR tests. Measurement command passed validated HTML/stream batches at concurrency 1/8/32 with empty server PATH and clean shutdown. | Application/ai1 dependency and migration acceptance; DF-17 production/provider/database workloads and longer stress. DF-12/16/18–20 remain downstream work; original JS-stack reporting policy remains open. |
