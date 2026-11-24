# Shell console specification

## Purpose

Provide a tool-aware shared local console with truthful authorization and lifecycle.

The [dated evidence](../../../examples/shell/tests/evidence/2026-11-24/README.md) define measured acceptance scope. Live certification is limited to OpenRouter/gpt-4o-mini.

## Requirements

### Requirement: Grounded bounded inspection

Read-only inspection SHALL require neither action approval nor a driver lease. Cwd-only questions SHALL perform one fresh pwd read, use at most two model requests and finish within a 15-second deadline.

#### Scenario: Grounded bounded inspection behavior

- **WHEN** a user asks what is your pwd with actions disabled
- **THEN** the assistant answers the actual cwd without asking for a toggle

### Requirement: Bound contents inspection

A location-and-contents question SHALL execute pwd and ls once each, use at most three model requests and obey a 25-second turn deadline.

#### Scenario: Bound contents inspection behavior

- **WHEN** the model repeats an unchanged successful read within the turn
- **THEN** the backend reuses its result without another execution

### Requirement: Backend action authorization

Actions SHALL require exact-argument approval bound to operation, tool, holder, boot and live lease; duplicate successful decisions SHALL replay receipts without redispatch.

#### Scenario: Backend action authorization behavior

- **WHEN** arguments change after approval was recorded
- **THEN** execution fails closed

### Requirement: Truthful cancellation and rows

Tool results SHALL settle foreground rows within 250 ms. Stop SHALL settle the visible turn within 500 ms, preserve completed receipts and reject late packets or approval continuations.

#### Scenario: Truthful cancellation and rows behavior

- **WHEN** an approval acknowledgement arrives after Stop
- **THEN** it does not restart the stopped model loop

### Requirement: Runtime freshness and sharing

The UI SHALL compare its expected backend source fingerprint with the running backend, and terminal replay SHALL deduplicate sequence IDs without collapsing repeated real commands.

#### Scenario: Runtime freshness and sharing behavior

- **WHEN** dev rebuilds after a production build while another tab is open
- **THEN** the console reconnects to the changed runtime and keeps each real terminal event once

### Requirement: Local capability boundary

The console SHALL remain a single trusted local process with allowlisted filesystem commands and separately approved bounded HTTPS text reads; it SHALL NOT imply authenticated multi-user isolation or an unrestricted OS shell.

#### Scenario: Local capability boundary behavior

- **WHEN** a user approves a web read
- **THEN** the tool reads bounded HTTPS text without JavaScript, cookies or automatic redirects

