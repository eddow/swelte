# Plus plugins specification

## Purpose

Provide optional jobs, embedded database and live rooms through explicit registration.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Plugin ownership

Jobs, embedded DB and room dispatch SHALL belong to explicitly registered Plus plugins; core SHALL retain generic transport primitives.

#### Scenario: Plugin ownership behavior

- **WHEN** a room-mode route is used without its owning plugin
- **THEN** generation fails with an actionable registration error

### Requirement: Document scheduler guarantees

Default jobs SHALL be process-local best effort; opt-in durable jobs SHALL serialize cooperating workers through the documented SQLite transaction and require idempotent bodies.

#### Scenario: Document scheduler guarantees behavior

- **WHEN** a durable worker dies after an external effect but before committing its deadline
- **THEN** the job can run again and its body must tolerate replay

### Requirement: Room cleanup

Room streams and sockets SHALL release subscriptions when their handler ends and SHALL not block publishers on slow subscribers.

#### Scenario: Room cleanup behavior

- **WHEN** a subscribed client disconnects
- **THEN** the runtime reaps its registered subscriptions

