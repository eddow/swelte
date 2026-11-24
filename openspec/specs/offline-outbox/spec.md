# Offline outbox specification

## Purpose

Persist explicitly queued browser mutations and replay them with stable identities.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Explicit enqueue

Only explicit enqueue requests for allowed same-origin mutation paths SHALL enter the outbox; ordinary fetch failures SHALL remain failures.

#### Scenario: Explicit enqueue behavior

- **WHEN** an ordinary RPC fails offline
- **THEN** the framework does not silently queue the mutation

### Requirement: At-least-once replay

Retries SHALL preserve the entry idempotency key; applications SHALL deduplicate that key and manage authenticated queue identity.

#### Scenario: At-least-once replay behavior

- **WHEN** a committed mutation loses its acknowledgement
- **THEN** a retry uses the same key so the endpoint can prevent duplicate effects

### Requirement: Observable retained failures

Permanent, expired or exhausted requests SHALL remain failed records until explicitly retried or discarded.

#### Scenario: Observable retained failures behavior

- **WHEN** a request exhausts its configured attempt budget
- **THEN** the entry remains observable as failed rather than disappearing

