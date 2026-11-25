# Proposal

## Why

The shared QJS package contains SSR rendering and AI execution policy, so its engine build requires agent glue even for SSR consumers. Moving each protocol into its owning adapter makes the shared engine reusable.

## What Changes

- Give ssr-qjs ownership of rendering entry points, module loading conventions, render bytecode caching, and HTML/head extraction.
- Give ai ownership of agent evaluation wrapping, binding dispatch integration, call counters, and call-limit failures.
- Keep generic runtime/context lifecycle, evaluation, execution limits, and host callback mechanisms in qjs.
- Update source staging and native linking for independent and combined consumers.

## Capabilities

### New Capabilities

None. This is an internal ownership refactor.

### Modified Capabilities

None. Existing rendering and AI behavior remains the acceptance baseline. Spec deltas are deliberately skipped.

## Impact

Touches engine/qjs, engine/ssr-qjs, engine/ai, generated V bridges, native archive construction, packaging tests, and ownership documentation. npm distribution continues as a planning assumption. Completing the currently stubbed agent host dispatcher is a separate feature.
