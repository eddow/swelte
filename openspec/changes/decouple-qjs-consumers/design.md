# Design

## Context

See proposal.md for motivation. engine/qjs/src/qjs.ts builds the shared archive and explicitly requires swelte_agent.c. qjs.v and agent.v share module qjs. The SSR bridge and agentBridgeSrc already live in their respective consumers.

swelte_qjs.c mixes runtime management with render-specific loading and caching. swelte_agent.c currently serializes binding arguments, counts calls, and rejects with a dispatcher-unavailable error. Moving that code must preserve this observed behavior and avoid claiming tool execution has been implemented.

Existing SSR requirements already assign synchronous rendering to the optional adapter. The agent-tooling spec describes MCP inspection, so it does not represent AI execution ownership.

## Goals / Non-Goals

The design establishes a reusable V/C engine layer and consumer-owned protocols. npm removal, a new V package distribution system, and completing native tool dispatch are outside this refactor.

## Decisions

### Shared engine boundary

QJS owns runtime handles, contexts, generic evaluation, job pumping, memory/time limits, and callback plumbing. Consumer context travels through explicit per-context data with documented lifetime. Runtime ownership and cleanup remain explicit across failures.

SSR owns the rendering driver, route/props convention, module resolution policy, render cache policy, HTML/head extraction, and render failure mapping. AI owns program wrapping, binding names and argument conversion, dispatch policy, call counters and limits, result limits, and agent failure mapping. Consumer C helpers may remain C and ship with their owner.

Keeping all helpers in qjs would retain the coupling. Rewriting all glue in V would enlarge the risk without being necessary to establish ownership.

### Build and link ownership

Build one target-specific engine archive containing QuickJS and generic glue. Each consumer compiles its own glue into a separate archive using the same compiler and target configuration. Generated V bridges link their consumer archive and the engine archive in dependency order. Preserve existing native and cross-target compiler selection and cache invalidation.

Move consumer V entry points into their owning generated modules and update every internal caller together. Keep the exported TypeScript build helper contract where feasible. Document any source-level migration for consumers of the shipped V files.

### Compatibility baseline

SSR output, diagnostics, strict behavior, caching correctness, and request isolation remain regression criteria. AI keeps current return/error behavior, including unavailable-dispatch rejection. Call budgets live exclusively in ai and count at the same boundary as today. Generic callbacks carry no tool-specific policy.

## Risks / Trade-offs

- Duplicate symbols or archive ordering failures → test SSR-only, AI-only, and combined native links.
- Callback lifetime or cross-request state leakage → use explicit context ownership and exercise overlapping executions and failure cleanup.
- Stale native objects after source moves → include owned sources and headers in rebuild invalidation and test a rebuild after modification.
- Accidental AI feature expansion → retain dispatcher-unavailable behavior in regression coverage.

## Migration Plan

Extract generic primitives, migrate SSR and AI consumers with their tests, then remove obsolete shared entry points and update package file lists and documentation. Validate packed installation as well as workspace builds. Rollback restores all three packages together because generated bridges and native symbols must agree.
