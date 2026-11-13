# Native application dogfooding roadmap

Updated: 2026-11-13.

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
| DF-05 | active | Versioned loads, initial hydration, reactive page state and awaited refresh update mounted props. Browser fixture proves query/back/forward, inherited loads on Svelte-only pages, redirects, hash preservation, stale-request suppression, tagged invalidation and local-state retention. Native watchdog proves 504. Remaining: dynamic-route/browser acceptance, refresh/navigation races and actual application flows. |
| DF-06 | verify | One SSR tree preserves nested head/context and per-level data; request-local state and root-first universal loads match browser hydration. Fixture proves exact SSR DOM retention and concurrent locale isolation. Remaining: complete native EMW locale/auth/head acceptance and representative production dependencies. |
| DF-07 | active | Named/legacy actions, synchronous interception, aborts, callback adapter, inline failures and awaited refresh implemented. Native/browser fixtures prove no-JS 422/303, filters, component/value retention, multipart binary bytes, submitter overrides, cross-page result isolation and action-error boundaries. Remaining: overlapping submission/navigation races and actual application mutations. |
| DF-08 | verify | [Native PostgreSQL recipe](../../fixtures/postgres/README.md) reuses V pooling/parameters/transactions; app-local backend staging and startup imports are wired. Disposable real DB passes typed UUID/UTC/JSONB/decimal/null rows, rollback, migration replay/checksum/failure, lock contention/cleanup and failed startup before dependent work. Remaining: reconcile actual application migration history and validate deployment dependencies there. No new ORM/plugin required. |
| DF-09 | active | Native render exceptions produce sanitized 500 plus matching initial error state; strict renderer/hydration fallback switches exist. Fixture verifies sanitized render failure. Remaining: original-error diagnostic transport, timeout/memory/output reason coverage and full ai1/Markdown/Paraglide/Tailwind dependencies. |

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
| DF-11 | active | Bounded stream channel, chunk limit, cancellation channel and idle/write timeout implemented. Native fixture passes disconnect and idle resource release; SSE emitters stop when transport closes. Remaining: slow-client/shutdown stress, room subscriber cleanup and ai1 run/subscriber lifetime scenarios. |
| DF-12 | pending | Integrate ai1-owned native provider, runner and PostgreSQL RunStore through EMV routes. Run shared scenarios for chat, replay/live handoff, stop/steer races, human waits and tools against the unchanged browser protocol. Track ports in ai1/EMV and framework defects here. |

Gate acceptance: first events arrive before provider completion; reconnect/replay,
persistence and cleanup follow the documented lifetime policy. No EMW/Node proxy
or hosted ai1 backend.

## Gate 3 — Operational readiness and complete EMV flows

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-13 | pending | Document/test dependency sharing and shutdown: initialize configuration, pool/migrations and registries before jobs; drain/stop jobs/streams and close resources. Existing startup-before-jobs ordering is the baseline, not a new scheduler project. |
| DF-14 | pending | Validate translated dynamic entries, SSR-only dynamic `/`, prerender opt-outs, canonical/head metadata and error status. Assert actual content in static artifacts and dynamic responses, not merely HTTP 200 or shell markers. |
| DF-15 | pending | Provide reporting hooks/context for native requests, loads, SSR and jobs, composable with ai1 reporting. Verify failures are observable without credentials. Correct docs claiming GET never redirects, ineffective refresh guarantees or blanket migration parity. |
| DF-16 | pending | Verify EMV contact/webhook intake, attachments, email, push, scheduling and PDF against native library implementations. Inventory enabled capabilities; do not silently omit flows. Reuse raw/binary/HTTP/crypto facilities before proposing framework APIs. |
| DF-17 | pending | Run production without Node; declare native dependencies. Measure startup, RSS, HTML latency and streaming under representative concurrency. Compare equivalent workloads before claiming performance improvements. |

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
Next: complete refresh/submission/navigation race acceptance, dynamic-route
browser coverage and SSR budget diagnostics, then integrate the first real
application slice without treating fixture coverage as a completed port.

For each session record task IDs advanced, changed contracts, fixture/test
evidence, remaining acceptance and next actionable step. Keep downstream behavior
tests in EMV/ai1/micro and minimal framework regressions in Swelte.

| Date | Progress | Validation | Next |
|---|---|---|---|
| 2026-11-08 | DF-00 done; consolidated EMV/micro overlap and ownership | 32 existing focused tests passed; temporary probes reproduced lifecycle/SSR/form defects; native E2E gates unrun | DF-01 installed-package fixture; DF-02/03 contracts |
| 2026-11-08 | DF-01–03 done; Gate 0 accepted; fixed SSR installed-package resolution and documented native integration/error-boundary limits | Packed native/UI fixture passed browser/type/native JSON/QJS checks; 51 SSR tests and 252 core tests passed (Node 22 core suite needs type-stripping flag) | DF-04–07 guarded lifecycle implementation; DF-08 PostgreSQL |
| 2026-11-13 | DF-04–11 advanced; migrated fixture to refactored library layout; native backend staging/startup imports, shared page lifecycle, forms, SSR state/tree and POST streaming implemented; PostgreSQL recipe added | 260 core and 51 SSR tests passed. `test:postgres -- --browser` passed packed-library, native empty-PATH JSON/QJS HTML, sanitized render failure, PostgreSQL, stream cleanup and real Chromium hydration/forms/history checks. PostgreSQL 18.6; disposable DB only. Broader examples suite blocked by V `-path` shell quoting. | Repair examples test runner; multipart/cross-page/action errors, tagged invalidation, navigation races; retain application gates open |
| 2026-11-13 | Resolved examples runner and header-filter regression; added awaited tagged invalidation, action error boundaries and broader browser acceptance | 262 core and 51 SSR tests passed. Full `test:examples` passed V/contract/build checks, 10 unit tests, 23 direct + 23 preview E2E cases and 17 dev/HMR cases. Final current-source `test:postgres -- --browser` passed multipart, submitter, cross-page, hash/stale navigation, action/load/universal errors, no-JS action errors, denied side effects and guarded binary bytes. Strict boot now fails rather than silently mounting after unexpected hydration failure; its negative-path coverage remains open. | DF-04 ready for application verification; DF-05/07 race/application cases and DF-09 diagnostics remain open |
