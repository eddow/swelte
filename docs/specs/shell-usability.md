# Shell usability roadmap and acceptance gates

Status: **completed and accepted for OpenRouter / `openai/gpt-4o-mini`**.
OpenAI Responses and Anthropic remain fixture-only, not live-certified.

Updated 2026-11-24. Scope: `examples/shell`, provider dispatch, approval,
shared terminal, cancellation and development reload. This document owns the
shell's usability gate; completion of the broader AI roadmap does not imply it.

The reported incident was a `pwd` question that showed six running “Inspect the
console” rows for 29 seconds and ended “Interrupted”. Earlier reports showed
raw tool syntax and requests to enable a toggle for read-only inspection.
The original runtime and complete conversation were not captured. Its exact
replay is unavailable; a synthetic repeated-read regression and a reconstructed
conversation using the supplied messages are retained instead.

## Product contract

Ordinary console questions receive short answers grounded in actual tool
results. Read-only `pwd`, `whoami`, `help` and `ls [path]` need no action toggle,
approval or driver lease. Other supported actions require the action toggle
and approval of their exact arguments. Read permission never grants actions.

This is a single trusted local console. Its cwd, transcript and stdin are shared
across tabs. Client caller strings are not authenticated identities. The human
POST endpoints are authoritative; this example has no multi-user isolation.
The terminal is an allowlisted filesystem console, not an unrestricted OS shell.
Browse is an approved HTTPS text reader, not an interactive browser. See the
[capabilities and limits](../../examples/shell/README.md).

## Success markers

Count actual backend starts independently from model requests, SSE deliveries
and rendered rows. Measure submission latency with a monotonic clock, excluding
startup. A failed deadline is a failed sample.

### S1 — Working directory

For `what is your pwd ?` and `Where is our console?`:

- Exactly one successful `pwd` read and no unnecessary tool.
- At most two model requests, with actual cwd in the final answer.
- No approval, toggle request, raw protocol, manual Stop or stale running row.
- Fixture completion within one second; live p95 ≤10 seconds, total deadline
  15 seconds.

The backend constrains cwd-only tasks to one fresh read even when older
conversation messages requested a listing. Native capable models must choose
that read first and answer after its result; repeated reads reuse the result.

### S2 — Location and contents

For `Where are we and what files are here?`, execute one `pwd` and one `ls`,
with at most three model requests. Answer from both actual results. Both rows
settle independently. Fixture completion within one second; live p95 ≤15
seconds with a 25-second total deadline.

### S3 — Current state and reuse

A human or approved `cd` followed by `pwd` returns the new directory. A completed
read may be reused only within the same turn and unchanged console revision.
Duplicates create neither another execution nor another row; a new question
must inspect current state. Failed reads remain typed failures and are not cached.

### S4 — Honest lifecycle and presentation

Thinking is model progress, not a tool call. Default tool rows use short labels
such as “Read working directory”, “List project files” or “Read a web page”.
Raw arguments and internal identifiers belong in diagnostics or the approval
queue, not the answer.

Each actual call has a stable ID. The UI maps waiting approval to `pending`,
execution to `active`, successful receipt to `done`, and failed/denied/expired/
interrupted unfinished work to `failed` with its turn/error context. These are
presentation states, not a claim that the console can undo completed effects.

A result settles its row within 250 ms in a foreground browser. Completed rows
survive later provider failures and Stop. Replay cannot downgrade settled rows
or create duplicate keys. Completion, disconnect and failure leave no active
rows. Approval waiting remains pending until a decision, not falsely completed
by its `waiting_approval` terminal event.

### S5 — Authorization and continuation

Read-only inspection works with actions off or on. Actions execute zero times
before approval and once afterwards. Backend approval binds operation ID,
holder, tool, exact validated arguments, boot and live driver lease. Changed
arguments/holder, denied/expired/superseded operations fail closed.

Concurrent decisions and lost acknowledgements replay the stored successful
receipt without redispatch. Continuation tokens are consumed atomically; two
requests cannot start two model loops. Continuation restores the saved provider,
model, system and generation settings. A late approval acknowledgement after
Stop cannot restart the model.

Pending approvals and unused continuations fail closed after restart.
Successful receipts persist in the console's KV database and remain
binding-checked. The generated approval table and mutex are process-local;
multiple server processes sharing a database are not supported or certified.

### S6 — Stop, preemption and bounded failure

Stop settles the visible turn within 500 ms, releases control, ignores late
packets and permits the next turn. Human terminal input from either tab preempts
the agent. No new tool may start after cancellation; authorization is rechecked
at execution. Already completed actions cannot be undone by Stop.

Provider waits have a hard watchdog: the smaller of 10 seconds and the remaining
turn budget, checked at most 100 ms apart. Detached late HTTP responses have no
stream or dispatch authority. Socket timeouts alone are insufficient. Budget,
provider and protocol failures finish with an error rather than a fabricated
answer or perpetual spinner.

### S7 — Tested source is served

The backend embeds a SHA-256 fingerprint of route/tools/filesystem source.
The UI carries its expected backend fingerprint and its own source fingerprint;
the badge polls for mismatch and boot changes. A protocol constant is not a
source revision. Production JS bundle names/hashes are recorded separately.

A production build while dev remains open must not prevent later backend
compilation. Recreate the session executable directory after generation.
Prove three consecutive build/edit/reload cycles with changed backend hash,
changed boot, matching UI expectation, one terminal frame after reconnect and
no active rows. Sequential terminal frames carry stable sequence IDs; real
repeated commands remain distinct while replay/optimistic echoes collapse.

## Completion roadmap

Checkmarks refer to the linked evidence, with provider scope and test limits
recorded in the [dated evidence](shell-usability-evidence-2026-11-24.md).

- [x] **P0: reproduce and measure.** Synthetic repeated `pwd` fixture; correlated
  model/tool/turn events, execution counts and metadata-only diagnostics.
  The original incident is not claimed as an exact replay.
- [x] **P1: bounded result-aware inspection.** Canonical read reuse, revision
  invalidation, latest-task scope, hard watchdog and no late dispatch.
- [x] **P2: provider transport.** Native aliases and linked typed results for
  OpenRouter, OpenAI Responses and Anthropic on wire-shaped fixtures; bounded
  legacy text fallback. No raw tool syntax in normal answers.
- [x] **P3: rendered lifecycle.** Completion, provider failure, approval pending,
  replay, disconnect, Stop and foreground receipt-to-paint assertions.
- [x] **P4: human control and recovery.** Authorization, delayed-ack Stop,
  cross-tab control and all three build/edit/browser reload cycles pass.
- [x] **P5: repeated live acceptance.** Final source/build passes 40/40 live
  samples plus eight live Chrome scenarios for OpenRouter/gpt-4o-mini. Other
  adapters remain fixture-only; see the dated evidence.

Any unexplained loop, raw protocol leak, unauthorized action or stale running
row reopens the affected marker. Do not replace missing evidence with a passing
unrelated test count.

## Repeatable acceptance pack

From `examples/shell`:

```sh
npm test                  # offline unit tests
npm run check
npm run test:integration  # build, native fixtures, Chrome lifecycle and signal-wait tests
npm run test:reload       # isolated dev + production build, three browser reload cycles
npm run test:live         # opt-in real provider requests; requires server .env key
```

Chrome tests require `google-chrome` or `CHROME_BIN`; the signal test needs a
system C compiler on POSIX. Live scripts deliberately do not run under `npm test`.
Tests use temporary databases/profiles; reload tests copy the project without
its `.env` and leave the user's running app untouched.

For each declared live pair collect ≥20 S1 and ≥20 S2 samples, evenly split
between clean and existing conversations and across ≥2 process starts. Record
all answers/failures, timings (p50/p95/max), model requests, tool starts,
approvals, backend/boot and bundle revisions. Require ≥95% grounded completion
inside budget, zero duplicate unchanged-read execution, protocol leaks,
unauthorized actions or stale rows. The harness currently requires 100% of
its samples. Existing sessions reconstruct only the user-supplied incident
messages, not unknown original state.

Browser proof additionally covers action approval/resume, an approved HTTPS
read, Stop, current cwd after human `cd`, and revision agreement. Deterministic
suites cover denial, invalid URL, fetch failure, binding changes, concurrent
resume/continuation, real TTL lapse, real restart, provider failure, malformed
calls, repeated frames, disconnect and late packets. Controlled SSE is used to
hold the short tool/final phases open for reproducible Stop assertions; this
must be distinguished from a live provider running that phase.

Live certification is per provider/model. OpenAI Responses and Anthropic
fixture conformance does not certify their live behavior. No keys or secret
prompt/result dumps belong in diagnostic traces. The opt-in acceptance artifacts
contain only the deliberately supplied test prompts and console fixture results.
