# npm V libraries specification

## Purpose

Resolve declared native and universal V exports through npm packages.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Declared module resolution

Swelte SHALL resolve declared npm V exports into deterministic reserved `npm_` namespaces and SHALL keep application-local `#lib` resolution separate.

#### Scenario: Declared module resolution behavior

- **WHEN** a consumer imports a declared scoped V package
- **THEN** generated compiler input uses the documented deterministic module namespace

### Requirement: Enforce target and path boundaries

Resolution SHALL reject escaping source paths, namespace collisions and browser imports of server-only exports.

#### Scenario: Enforce target and path boundaries behavior

- **WHEN** browser code imports a server-target V export
- **THEN** generation fails instead of exposing server facilities

### Requirement: Explicit plugin registration

Library plugins SHALL execute only through explicit registration and SHALL prune stale generated output after removal.

#### Scenario: Explicit plugin registration behavior

- **WHEN** a registered plugin is removed
- **THEN** its generated files are pruned without discovering executable plugins from dependency metadata

