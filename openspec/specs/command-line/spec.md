# Command line specification

## Purpose

Build, develop, inspect and package Swelte projects through the CLI.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Separate application and library builds

The CLI SHALL distinguish application builds from reusable-library packaging and SHALL NOT publish or deploy as a side effect of either command.

#### Scenario: Separate application and library builds behavior

- **WHEN** a developer runs `swelte package`
- **THEN** library output is produced separately from application `dist` output

### Requirement: Own development processes

The development command SHALL manage its backend process and recover its executable directory after generated output is cleaned by a production build.

#### Scenario: Own development processes behavior

- **WHEN** a backend edit follows a production build while dev remains open
- **THEN** dev compiles and serves the edited backend without manual directory repair

