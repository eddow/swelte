# Forms specification

## Purpose

Support typed mutations and progressively enhanced HTML forms.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Verb and qualifier selection

Form mutations SHALL select handlers by HTTP method and documented query qualifier; JSON RPC selection SHALL remain separate.

#### Scenario: Verb and qualifier selection behavior

- **WHEN** a form posts with the delete qualifier
- **THEN** the matching qualified POST handler runs rather than a JSON RPC function

### Requirement: Progressive result handling

Enhanced forms SHALL apply the documented success, failure, redirect and error outcomes while no-JS forms remain usable.

#### Scenario: Progressive result handling behavior

- **WHEN** a no-JS page form returns validation failure
- **THEN** the guarded target page renders with failure status and form data

