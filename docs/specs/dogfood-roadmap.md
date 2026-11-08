# Native application dogfooding roadmap

Updated: 2026-11-08.

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
| V PostgreSQL | Bundled toolchain contains ORM, pooled `pg.DB`, parameterized execution, pinned `db.conn()` and transactions. Live database behavior and reproducible deployment still need validation. |
| Native SSR | Embedded QuickJS and per-render runtime/context exist. Application composition, state and fallback behavior need fixes/validation. |
| npm V modules | Current working tree materializes universal/server exports; server entries skip browser RPC projection. Packed ai1 consumption is unproven. Do not assume this working-tree implementation is released. |
| HTTP primitives | Cookies, structured/binary responses, raw bodies, uploads, loads and middleware exist. Cross-path behavior is incomplete. |
| Realtime / jobs | GET SSE, WS rooms and cron ticks exist. POST streaming, guard coverage and cancellation are incomplete; ticks do not establish durable queue semantics. |

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
| DF-01 | pending | Pack/install a minimal ai1-shaped dependency with Svelte UI and server V modules: nested modules, interfaces, callbacks/channels and a native dependency. Build a native consumer; resolve browser declarations; reject browser imports of server exports. Record tested V/Svelte/Vite/package versions, including the Vite 6/8 decision. |
| DF-02 | pending | Specify state and wrapper/leaf data/form contracts, route identity including groups or equivalent metadata, request-local SSR state, safe initial serialization, refresh and redirect/error behavior. Define navigation load requests alongside same-path JSON endpoints. Decide adapter scope while preserving current consumers. |
| DF-03 | pending | Specify unambiguous action selection. Current `q` qualifier collides with EMW search `q`; bare empty query keys can select handlers. Preserve public/search URLs and define named/cross-page action behavior with and without JS. |

Gate acceptance: the installed native/UI consumer compiles, and lifecycle/action
contracts are concrete enough to implement and test together. This is a small
feasibility fixture, not a port of the full ai1 backend.

## Gate 1 — Guarded, hydrated page and PostgreSQL mutation

First application slice: root wrapper, translated landing page and `/threads`
read/mutation. Authorization and metadata belong here even though parts appeared
under P1 in the original requirements.

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-04 | pending | Unify guarded requests for HTML, navigation loads, mutations, binary endpoints, SSE and WS before handler execution/connection takeover. Carry middleware locals into loads; preserve cookies/headers and support middleware redirects. Unauthorized requests cannot reach protected handlers/loads/streams. |
| DF-05 | pending | Run the same V load contract for HTML, client navigation and refresh. Transfer initial data safely into hydration; supply wrapper/leaf props and initialized reactive page state. Preserve query/hash/history; handle redirects/errors without mounting a success page. Refresh data without unnecessarily discarding local UI/form state. |
| DF-06 | pending | Fix SSR composition to retain head metadata and wrapper/leaf data. Validate parent context and snippets through the composed tree. Render an EMW-shaped root wrapper; preserve locale/auth isolation and verify hydration with exact initial data. |
| DF-07 | pending | Fix synchronous interception and cancellation, callback/result adaptation and refreshed props. Cover inline validation, optional reset/value retention, multipart and cross-page submission. Preserve filters on refresh and no-JS redirect. |
| DF-08 | pending | Integrate existing V PostgreSQL: pool/startup recipe, query/mutation, wire types, rollback and pinned advisory-lock cleanup. Reconcile existing migration history; test replay, migration coordination and failed initialization before jobs. Document native dependencies. Add an optional package only where repeated integration justifies it. |
| DF-09 | pending | Expose SSR failure reasons and strict checks for unexpected fallback: render exception, timeout, memory/output limits and hydration fallback. Retain original errors for diagnostics; sanitize client output. Exercise representative ai1/Markdown/Paraglide/Tailwind dependencies. |

Gate acceptance in EMV: direct HTML has correct locale, head and status before
JS; hydration retains data; `/threads?filter=unread&q=example` supports read/note/
status mutations without losing filters; failures stay inline; back/forward load
the correct query. No-JS forms work. Unauthorized variants cannot execute
protected work. PostgreSQL tests use an isolated real database.

Implementation starting points:

- [Client entry](../../engine/core/templates/client/main.ts): hydration currently
  receives no initial props.
- [Router](../../engine/core/src/vite/client-router.ts): ordinary GET JSON for
  navigation, missing wrapper data and lost query on popstate.
- [SDK](../../engine/core/src/sdk.ts): store state, invalidation without reload,
  awaited callbacks before submit prevention.
- [Harness](../../engine/core/templates/harness/server.v): qualifiers, stream
  interception outside ordinary dispatch and reconstructed load requests.
- [Server generation](../../engine/core/src/vite/server-gen.ts): middleware,
  load cascades and transport accessors.
- [SSR composition](../../engine/ssr-qjs/src/ssr.ts): undefined page shims,
  separate nested renders, discarded head and swallowed exceptions.

## Gate 2 — Native ai1 streaming application

| ID | Status | Deliverable / acceptance |
|---|---|---|
| DF-10 | pending | Support native POST response streams with request bodies and response headers, including `x-ai1-run-id`. Support ai1 named SSE framing without double encoding, failures before headers and termination after headers. Reuse V incremental HTTPS callbacks for the upstream adapter. |
| DF-11 | pending | Make disconnect/cancellation observable; release blocked producers/subscribers, bound buffering and define idle timeout. Test slow clients, fragmented UTF-8/frames and shutdown. Preserve ai1's distinct run/subscriber lifetimes; disconnect does not universally cancel a run. |
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

Audit complete; no delivery gate accepted and no framework fix implemented in
this review. Start DF-01, DF-02 and DF-03, then implement Gate 1 as a coordinated
lifecycle change. Do not start the full native ai1 port before package feasibility.

For each session record task IDs advanced, changed contracts, fixture/test
evidence, remaining acceptance and next actionable step. Keep downstream behavior
tests in EMV/ai1/micro and minimal framework regressions in Swelte.

| Date | Progress | Validation | Next |
|---|---|---|---|
| 2026-11-08 | DF-00 done; consolidated EMV/micro overlap and ownership | 32 existing focused tests passed; temporary probes reproduced lifecycle/SSR/form defects; native E2E gates unrun | DF-01 installed-package fixture; DF-02/03 contracts |
