# Proposed framework work

## First investigation — keep a browser tab open across releases

Extend the [dogfood fixture](../../fixtures/dogfood/README.md) with two production builds served successively at the same origin. Open a tab on release A and queue an offline write. Switch to B, then use the existing tab to navigate to a lazy-loaded page, submit an A-shaped mutation and replay the queued write. Record which assets loaded, which requests B accepted and what the user saw.

Run once with a compatible RPC change and once with a new required request field. Use the results to prioritize asset retention, update detection and contract diagnostics. Keep the two releases independently buildable so each observed failure can become a regression case.

## Account-scoped offline writes

Let an app attach an opaque account identifier to an [outbox](../specs/offline-outbox/reference.md) entry and discard entries for that account on logout. A worker should hold a scoped entry until the app confirms the active account, including after a worker restart. Define how the server verifies the intended account when cookies change between confirmation and delivery.

Acceptance case — Alice queues a write offline, signs out, and Bob signs in before connectivity returns. Exercise both automatic and manual retries. Bob must never receive Alice’s mutation. Also verify that a pending entry can replay when Alice is still signed in and that existing unscoped entries retain their delivery behavior.

## Explain how a URL resolves

Add `swelte explain <url>` and expose the same result through [MCP](../specs/agent-tooling/reference.md). Show the selected route, decoded params, inherited wrappers and loads, applicable guards, nearest error boundary and configured rendering mode. Include source paths. Identify decisions that depend on request data, such as a host-based reroute.

Acceptance case — for a grouped dynamic route with a parent load and a nested error boundary, the CLI and MCP identify the same files in runtime order without executing app hooks.

## Check released RPC contracts for compatibility

Compare the [contract snapshot](../specs/command-line/reference.md) for a proposed release with a user-selected release baseline. Report changes from the perspective of an existing client calling the new server. Name the RPC, the affected field and whether it appears in the request or response.

Acceptance case — CI flags a newly required request field as breaking, recognizes an added optional response field as compatible, and reports an unclassified change as requiring review. Use the two-release fixture to check these classifications against actual calls.

## Compare native and browser WASM results

Let a library author select a pure V export and supply input cases with expected results. Run each case through the native implementation and the generated browser WASM stub. Report both observed values and identify the failing input. Exercise the same [package entry point](../specs/npm-v-libraries/reference.md) a consumer imports.

Acceptance case — a packed library fixture covers Unicode strings, empty arrays and numeric boundaries within the declared wire type. An intentional discrepancy produces a failing check that identifies the export, input and differing values.

## Expose per-request SSR timings

Add opt-in `Server-Timing` metrics for page loads and QuickJS rendering, plus the ISR cache outcome. Define the timing of a stale response separately from background regeneration so browser tools show only work the request waited for.

Acceptance case — inspect cold, fresh and stale responses for the same page. A deliberately slow load appears in the load measurement, a cache hit reports its outcome, and disabling instrumentation omits the metrics. Use the [native measurement fixture](../specs/native-lifecycle/measurements.md) to quantify overhead.
