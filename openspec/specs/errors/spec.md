# Errors specification

## Purpose

Keep client-visible transport failures predictable.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Typed transport errors

Fetch and WASM stubs SHALL reject failures as `SwelteRpcError`, with HTTP status for server calls and status zero for local WASM failures.

#### Scenario: Typed transport errors behavior

- **WHEN** a local WASM invocation traps
- **THEN** the caller receives the documented error type with status zero

### Requirement: Content-aware error handling

API errors SHALL retain JSON envelopes while browser form navigations SHALL use their documented HTML/redirect behavior.

#### Scenario: Content-aware error handling behavior

- **WHEN** an API request names an unknown RPC
- **THEN** the backend returns a 404 JSON error with the available functions when applicable

