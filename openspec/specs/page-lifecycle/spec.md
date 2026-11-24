# Page lifecycle specification

## Purpose

Preserve guarded page loads, nested state and mutation outcomes across SSR and navigation.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Guarded load order

Page requests SHALL execute applicable guards and loads root-first, preserve wrapper-level data and encode redirect/error outcomes consistently.

#### Scenario: Guarded load order behavior

- **WHEN** a nested page has parent and leaf loads
- **THEN** the page envelope preserves their ordered levels and final merged data

### Requirement: Hydrate initial state

SSR SHALL serialize escaped public page state and the browser SHALL hydrate that state without an initial refetch or default-props pass.

#### Scenario: Hydrate initial state behavior

- **WHEN** initial data contains HTML-significant characters
- **THEN** the inert JSON is escaped and hydration receives the same data

### Requirement: Refresh mounted data

Active-page invalidation SHALL await the applicable refresh and update mounted props while preserving component state.

#### Scenario: Refresh mounted data behavior

- **WHEN** a current load dependency is invalidated
- **THEN** the refresh updates page data without discarding unrelated component state

