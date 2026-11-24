# Native streams specification

## Purpose

Deliver application-framed bytes with bounded buffering and cancellation.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Preserve byte framing

The native POST stream transport SHALL deliver application-owned bytes without encoding JSON or adding SSE framing.

#### Scenario: Preserve byte framing behavior

- **WHEN** a producer emits split UTF-8 byte chunks
- **THEN** the transport preserves the bytes for the client decoder

### Requirement: Bound buffering and cleanup

Writes SHALL respect the bounded queue/chunk limit and expose cancellation on disconnect or timeout so producers can release resources.

#### Scenario: Bound buffering and cleanup behavior

- **WHEN** a stream write returns false
- **THEN** the producer stops emitting and releases its owned resources

### Requirement: Headers precede production

Status and headers SHALL be determined before the streaming producer begins.

#### Scenario: Headers precede production behavior

- **WHEN** a producer fails after response headers are sent
- **THEN** the stream closes with a generic server diagnostic rather than changing HTTP status

