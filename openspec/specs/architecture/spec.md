# Architecture boundaries specification

## Purpose

State the supported native-server and Svelte-browser execution model.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Native production boundary

Swelte SHALL build its documented server behavior into a native V artifact while Svelte supplies the browser UI; optional QuickJS rendering SHALL remain synchronous.

#### Scenario: Native production boundary behavior

- **WHEN** a built native application serves HTML and API requests
- **THEN** server operation does not require a server-side Node process for those requests

