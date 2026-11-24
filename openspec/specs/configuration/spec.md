# Configuration specification

## Purpose

Define application configuration and deployment/runtime overrides.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Environment precedence

Documented runtime environment overrides SHALL take precedence over configuration fallbacks; unset or invalid positive-limit overrides SHALL use their built-in defaults.

#### Scenario: Environment precedence behavior

- **WHEN** a positive runtime limit is set to zero
- **THEN** the built-in default applies rather than disabling the limit

### Requirement: Optional generated features

Service-worker, prerender, image and offline output SHALL follow their explicit documented configuration.

#### Scenario: Optional generated features behavior

- **WHEN** service-worker generation is disabled
- **THEN** the build adds no service-worker registration or worker asset

