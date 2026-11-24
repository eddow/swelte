# Example application specification

## Purpose

Keep a runnable demonstration of native, browser and transport integration.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Executable examples

The `examples/something` application SHALL demonstrate server RPC, browser WASM and structured errors using the same public interfaces as consumers.

#### Scenario: Executable examples behavior

- **WHEN** a developer builds and previews the example
- **THEN** its documented routes are served from the generated native artifact and static assets

