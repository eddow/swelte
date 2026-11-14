# Swelte implementation and verification roadmap

Updated: 2026-11-14.

This roadmap tracks capabilities that Swelte must implement, document, or
regression-test in this repository. The dogfood application and installed
sample library are synthetic fixtures: they exist only to exercise Swelte
contracts. Their features, completeness, deployment, and resemblance to any
real application are not goals.

Earlier audits of external application specifications helped expose framework
gaps and probe assumptions. Those specifications are context only. This
roadmap does not assign work to another repository, require application ports,
or claim that application acceptance is needed to complete Swelte. PostgreSQL
is an example of connecting Swelte to V's existing `db.pg` ORM, pooling,
parameterized queries, and transactions; it did not require a new ORM or a
PostgreSQL implementation in Swelte.

## Scope and completion rule

A Swelte task is complete when its framework behavior has a documented
contract and a focused regression check in the relevant core, SSR, native, or
browser fixture. A synthetic fixture is sufficient; its product behavior is
irrelevant beyond the assertion being probed. Production app migrations,
provider integrations, domain workflows, schemas, auth policy, and deployment
acceptance belong to their respective projects and do not block this roadmap.

Statuses: `done` means Swelte behavior and regression coverage are in place;
`active` means a Swelte-owned gap remains; `out of scope` records a requirement
that does not belong to Swelte. Task IDs are retained for traceability, not as
an obligation to recreate the source application.

## Framework capabilities

**Status: complete.** Every Swelte-owned capability in this audit has
implementation, contract documentation, and regression coverage. There are no
open Swelte tasks from this roadmap. Future dogfood changes should add a task
only when a fixture reveals a missing framework behavior.

| ID | Status | Swelte capability and evidence |
|---|---|---|
| DF-00 | done | Requirements audit separated framework gaps, existing V facilities, and application-only work. |
| DF-01 | done | [Installed package fixture](../../fixtures/dogfood/README.md) packs and installs a synthetic Svelte/V library; checks declarations, browser/server boundaries, native V exports, and QuickJS SSR with an empty runtime PATH. |
| DF-02 | done | [Page lifecycle contract](page-lifecycle-contract.md) defines request-local state, load cascades, hydration data, headers, refresh, errors, and redirects. |
| DF-03 | done | The lifecycle contract defines named action selection, no-JS behavior, query retention, and compatibility behavior. |
| DF-04 | done | Shared request guards cover UI, load, action, binary, SSE, and WS paths. Native fixture checks locals, redirects, headers/cookies, denied side effects, and cross-origin write rejection. |
| DF-05 | done | Versioned loads, hydration, reactive state, tagged invalidation, history, dynamic routes, stale-result suppression, and navigation/refresh priority have browser regression coverage; native watchdog behavior is covered. |
| DF-06 | done | One SSR tree preserves nested head/context and per-level data. Request-local state, root-first universal loads, hydration retention, and concurrent isolation are exercised by native/browser fixtures. |
| DF-07 | done | Named and legacy actions, no-JS responses, interception, aborts, multipart bytes, submitter overrides, inline errors, error boundaries, cross-page isolation, and awaited refresh have fixture coverage. |
| DF-08 | done | PostgreSQL uses V's existing ORM and driver facilities. The [disposable PostgreSQL fixture](../../fixtures/postgres/README.md) probes typed values, transactions, migrations, locking, failure cleanup, and startup ordering. No new ORM/plugin is required. |
| DF-09 | done | Strict SSR/hydration, sanitized client failures, bounded native reason codes, timeout/memory/output/compile/exception reporting, and cache-eviction concurrency have regression coverage. Original JS stacks are opt-in native diagnostics; ordinary client and console output stays sanitized. |
| DF-10 | done | `swelte_stream` writes native POST response bytes with bounded buffering, framed SSE examples, first-event-before-completion behavior, fragmented UTF-8, and pre/post-header failure behavior. |
| DF-11 | done | Cancellation, slow-reader timeouts, idle SSE detection, repeated room-subscription cleanup, WebSocket completion, and shutdown draining are covered by native fixtures, including a repeated concurrency stress run. |
| DF-13 | done | Startup ordering, failure isolation, cooperative signal shutdown, bounded draining, cron work, stream cleanup, and shutdown hooks are specified in [lifecycle docs](../lifecycle.md) and exercised natively. |
| DF-14 | done | Prerender fixtures cover grouped/dynamic entries, inherited opt-outs, encoded params, canonical/head output, error/redirect/shell exclusion, safe artifact cleanup, and hydration with the hosting URL. |
| DF-15 | done | Optional `@[report]` provides request IDs and server-side lifecycle/error reports; callback failures are isolated. Documentation defines event fields, privacy boundaries, and correlation limits. |
| DF-17 | done | [Repeatable native fixture measurements](../native-runtime-measurements.md) cover startup, memory, SSR, POST streams, concurrency levels, empty server PATH, and clean shutdown. The recorded sample explicitly makes no production-capacity or comparative-performance claim. |
| DF-21 | done | `swelte-ssr check` runs the sidecar, Hand, embedded production, repeat-render, and artifact probes; process-group cleanup is regression-tested so the CLI exits after the gate. |
| DF-12 | out of scope | Application-owned providers, runners, persistence models, replay semantics, and domain workflows are not Swelte framework requirements. Swelte's generic native streaming transport is covered by DF-10/11. |
| DF-16 | out of scope | Email, push, scheduling, PDFs, and application-specific intake flows are integrations or domain behavior. Swelte provides generic HTTP, binary, upload, and lifecycle primitives where applicable. |
| DF-18–20 | out of scope | Application authentication policy, durable financial workflows, payments, banking, and document/media processing are not Swelte implementation goals. |

## Current baseline and limits

The fixture proves the contracts listed above on the pinned toolchain; it is
not an application migration or production benchmark. The PostgreSQL fixture
uses V's existing facilities with a disposable database. The native measurement
sample is a short loopback run
without TLS, real provider traffic, or a comparison server. Vite 6 is the
supported pilot baseline; the fixture does not claim Vite 8 compatibility.

Run the relevant focused checks when changing an area: core tests for routing,
contracts, and generation; SSR C/QuickJS tests for rendering and diagnostics;
`npm run test:dogfood -- --browser` for native lifecycle, package, stream, and
hydration behavior; `npm run test:postgres -- --browser` for the disposable
database path; and `npm run measure:dogfood -- <retained-fixture-app>` for the
repeatable measurement workload. These are Swelte verification tools, not
acceptance gates for another project's features.

For editor type resolution in the source fixture, `npm run prepare:dogfood`
builds and installs its local sample-library dependency. The test runner
excludes local generated output and still installs a fresh packed tarball.

Verification on 2026-11-14: core passed 268 tests with Node 22's
`--experimental-strip-types` (needed by two legacy dynamic `.ts` imports); SSR
passed 55, including a subprocess check that `swelte-ssr check` exits naturally;
the full `swelte-ssr check` also passed its sidecar, Hand, embedded production,
20x repeat-render, and artifact probes. Plus passed 17; `test:examples` passed its V/contract checks, build,
10 unit tests, 23 direct preview tests, 23 served preview tests, and 17 dev/HMR
tests. `test:dogfood -- --browser` passed in both default and `--prod` builds.
`test:postgres -- --browser` passed against a disposable PostgreSQL 18.6
database using extracted libpq development files. The fixture used the bundled
V SQLite amalgamation for `@swelte/plus/db`. These runs verify framework
behavior on this pinned Linux toolchain; they do not imply support for other
toolchain versions or application-specific workflows.

## External audit references

[`micro.md`](micro.md) preserves a historical application-specific inventory
as an audit reference. Its feature list does not expand Swelte's scope. Keep
Swelte behavior and regression status here; do not use this roadmap to track
or imply work in sibling repositories.
