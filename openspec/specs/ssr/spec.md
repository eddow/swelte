# Server-side rendering specification

## Purpose

Render guarded public page state with the optional synchronous QuickJS adapter.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Optional rendering engine

Core SHALL retain SPA/static and JSON operation without an SSR engine; the optional adapter SHALL own synchronous rendering and its development sidecar.

#### Scenario: Optional rendering engine behavior

- **WHEN** an application has no SSR adapter installed
- **THEN** normal application output remains usable without a server-side JavaScript runtime

### Requirement: Keep server work outside render

QuickJS component rendering SHALL reject unsupported asynchronous or server-fetch work at render time while permitting deferred client event handlers.

#### Scenario: Keep server work outside render behavior

- **WHEN** a component calls an RPC stub at top level during SSR
- **THEN** the build diagnoses the unsupported call

### Requirement: Bound failure and isolation

Rendering SHALL isolate request state, emit bounded failure diagnostics and honor strict-mode failure instead of unexpected fallback.

#### Scenario: Bound failure and isolation behavior

- **WHEN** strict rendering encounters an unexpected renderer failure
- **THEN** the request fails rather than silently accepting an SSR fallback

