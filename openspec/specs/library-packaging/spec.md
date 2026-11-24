# Library packaging specification

## Purpose

Publish reusable Svelte/TypeScript and V sources from one project shape.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: One project shape

A Swelte project SHALL support application builds and library packaging without a separate app/library project kind.

#### Scenario: One project shape behavior

- **WHEN** a project contains only reusable library sources
- **THEN** packaging does not require routes, a server build or a V compiler

### Requirement: Validate public exports

Packaging SHALL validate publication metadata, include declared V sources and exclude application routes from reusable output.

#### Scenario: Validate public exports behavior

- **WHEN** a declared V export escapes its source directory
- **THEN** publication validation fails before output is accepted

