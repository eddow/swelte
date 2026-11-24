# Type projection specification

## Purpose

Generate TypeScript declarations matching the supported V wire surface.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Wire-aligned projection

Generation SHALL project supported V structs and signatures into TypeScript, preserving optional/fallible behavior and the documented primitive mappings.

#### Scenario: Wire-aligned projection behavior

- **WHEN** a V RPC returns an optional value
- **THEN** its TypeScript result includes null and the generated call remains asynchronous

### Requirement: Project only public boundaries

Unattributed helpers and middleware SHALL NOT become client-callable exports; public wrapper structs SHALL remain available for projection.

#### Scenario: Project only public boundaries behavior

- **WHEN** a route wrapper defines middleware and a public struct
- **THEN** the struct is projected but middleware is not exported as a callable

