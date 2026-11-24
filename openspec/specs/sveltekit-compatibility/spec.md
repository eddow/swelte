# SvelteKit compatibility specification

## Purpose

Describe the supported SvelteKit migration surface and its limits.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Explicit compatibility boundary

Swelte SHALL retain its native route, V transport and default flat-props contracts while offering the documented opt-in SvelteKit compatibility mode.

#### Scenario: Explicit compatibility boundary behavior

- **WHEN** an application enables the documented compatibility mode
- **THEN** page components receive the documented data/form/params shape without requiring SvelteKit server modules

### Requirement: Preserve unsupported-feature boundaries

The migration reference SHALL distinguish implemented features, deliberate differences and unsupported SvelteKit APIs.

#### Scenario: Preserve unsupported-feature boundaries behavior

- **WHEN** a developer migrates an application
- **THEN** the reference identifies Swelte equivalents and limitations rather than claiming complete SvelteKit parity

