# Agent tooling specification

## Purpose

Expose project inspection and diagnostics through MCP and skills.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Shared diagnostics

The MCP check interface SHALL use the same structured diagnostic contract as `swelte check --format json`.

#### Scenario: Shared diagnostics behavior

- **WHEN** an agent requests project diagnostics
- **THEN** results identify the same errors and warnings as the CLI check

### Requirement: Project-scoped inspection

Agent tooling SHALL inspect the selected project route/type/WASM surfaces rather than requiring agents to read generated bundles.

#### Scenario: Project-scoped inspection behavior

- **WHEN** an agent requests route information
- **THEN** the MCP interface returns the documented project route metadata

