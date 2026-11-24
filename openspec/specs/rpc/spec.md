# RPC and V imports specification

## Purpose

Bind typed V declarations to server transport or local browser execution.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Directory selects runtime

Attributed public functions under routes SHALL bind to server transport; universal library RPCs SHALL bind to browser WASM; backend-only modules SHALL be rejected from browser imports.

#### Scenario: Directory selects runtime behavior

- **WHEN** browser code imports a backend-only V module
- **THEN** generation reports an error naming the offending import

### Requirement: Separate RPC and HTTP handlers

RPC SHALL use a typed single-argument struct and typed value result; HTTP verbs SHALL use the documented method/qualifier transport and response contracts.

#### Scenario: Separate RPC and HTTP handlers behavior

- **WHEN** a JSON body selects a named RPC
- **THEN** form qualifiers do not change the selected RPC

### Requirement: Validate route declarations

Duplicate method defaults, conflicting qualifiers and invalid lifecycle attribute placement SHALL fail generation with source locations.

#### Scenario: Validate route declarations behavior

- **WHEN** two functions claim the same default POST handler in one file
- **THEN** generation rejects the ambiguity

