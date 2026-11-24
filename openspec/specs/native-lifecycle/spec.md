# Native lifecycle specification

## Purpose

Define startup, cooperative drain and native reporting behavior.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Cooperative shutdown

The native runtime SHALL stop accepting tracked work, drain or reach the configured shutdown bound, and invoke the documented shutdown hooks.

#### Scenario: Cooperative shutdown behavior

- **WHEN** SIGTERM requests shutdown
- **THEN** lifecycle-managed resources are drained according to the documented bound

### Requirement: Server-side reporting

Native reporting SHALL retain sensitive failure details on the server and use bounded generic client diagnostics.

#### Scenario: Server-side reporting behavior

- **WHEN** a native task reports an internal failure
- **THEN** the reporting hook receives its documented event without exposing original exception bodies in public diagnostics

