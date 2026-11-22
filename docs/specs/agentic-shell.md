# Agentic shell: AI driving the shell example's terminal

Status: implemented — steps 1–4 done (`swelte check` clean, `npm test` 27/27).
Scope: `examples/shell` only — a consumer of `@swelte/ai`,
never a framework surface. Decisions made here may later graduate into
framework guidance, but nothing in this spec adds API to `@swelte/ai`,
`@swelte/core`, or `@swelte/plus`.

## 0. Implementation status

- [x] Step 1 (build order §10.1): `tool_shell_exec` / `tool_shell_send_input` /
  `tool_shell_read_output` as `@[tool]` fns in `src/lib/backend/shell_tools.v`;
  driver lease KV (`shell:driver` + `shell:driver:expires`, holder-bound,
  90s TTL) with `shell_handoff` / `shell_release` RPCs; legacy
  `shell:approval:*` path retired from `exec(caller:'ai')` (offline/test path
  only — fails actionably pointing at `tool_shell_exec`); human `exec` /
  `send_input` preempt any AI lease. Verified: `swelte check` clean,
  `swelte build` ok, `npm test` 27/27, live `preview` loop (handoff →
  approve → exec → replay → contention reject → preempt → release →
  fail-closed).
- [x] Step 2a (observe turn, §2 Stage A / §10.2 fixture 3): `ai_stream_run`
  streams provider text first, then one non-streaming tool-call pass
  (`ai_observe_followup_body` per adapter, example-local `<tool name
  args>` line parsed by `ai_parse_observe_call`) dispatches read-only
  tools only (`tool_shell_read_output` + `tool_top_commands`, caller
  `ai-observe`, never the lease holder) with `tool.progress` + bounded
  result text (≤1024B, truncation marked) back into the same turn.
  Malformed/no line → plain text turn. Verified: `swelte check` clean,
  `npm test` 27/27 (observe parse-gate test).
- [x] Step 2b (driving turn, §2 Stage B / §10.2 fixtures 1–2): per-turn
  "let AI use terminal" scope in the send box (`drive=1` form flag);
  `ai_stream` hands off `shell:driver = ai:<runId/turn-1>` before the text
  pass (contention rejects, expiry re-checked against the wall clock);
  driving tail (`ai_drive_turn_tail`) parks exec/input as one dispatch-table
  record with `approval.request` (tool+args+holder, mirrored into the pane
  approval queue) and closes `waiting_approval`; human approve resumes
  via `shell_tool_resume` (records `approved` on the dispatch-table record,
  holder + expiry re-check → dispatch once → bounded result →
  terminal paint) or deny via `shell_tool_deny` (records `denied`, late
  resume fails closed); Stop press `shell_release`s + drops
  the parked call. Deterministic adapter parks `pwd` without a provider
  key so the loop is exercisable offline. Verified: `swelte check` clean,
  `swelte build` ok, `npm test` 27/27 (driving-gate + resume-protocol tests).
- [x] Step 3 (Stage C / §10.3): scoped stdin pre-approval + transcript-tail
  re-entry. `ShellExecArgs` gains `op_id`; starting `cat` writes
  `shell:stdin:scope:<op_id> = holder`, `shell_stdin_scope_holds`
  re-checks row + live lease at every use (flip/expiry/holder-change →
  dead scope → per-keystroke path); a scoped `send_input` in the driving
  tail auto-records + dispatches inline (`shell.send_input (scoped)`,
  no parked approval). Both followup bodies inject `transcript_tail(5)`
  (last-5 scrollback frames, ≤1024B, truncation marked) as turn context.
  §6 scope wording aligned (lazy-dead rows). Verified: `swelte check`
  clean, `swelte build` ok, `npm test` 27/27 (scope + schema tests).
- [x] Step 4 (Stage D / §10.4): fixtures 4–7, budgets into the suite.
  Fixture 4 (reclaim: flip denies, human path byte-identical), 5
  (denial/expiry fail-closed, actionable errors), 6 (two-tabs contention
  rejects, idempotent re-handoff, post-expiry takeover), 7 (double-gate:
  one record, approve-late resumes once, replay-safe, denied twin
  errors). §8 budgets: exec/input/read args ≤256B req, results/tail
  ≤1024B res with truncation marked. Fixture mirrors use real time
  (`driverHolds` reads the wall clock — fake epochs test expired).
  Verified: `swelte check` clean, `swelte build` ok, `npm test` 27/27.

Trust note (demo): `caller` (`human`/`ai`) arrives as a client-supplied RPC
parameter today. Backend checks below are enforced honestly but not
unforgeably — a demo client can claim either caller. Resolve real identity
before treating the shell as anything but a local demo.

## 1. What exists today (all steps landed)

One allowlisted backend shell (`echo pwd whoami help cat`) shared by two
faces on `/` (`examples/shell`):

- **Chat pane** (left) — streams provider text (`text.delta` → `terminal`
  over `POST ?q=ai_stream`), renders thinking/tool/approval rows, keeps an
  approval queue. Read-only observe turns dispatch `tool_shell_read_output` +
  `tool_top_commands` (caller `ai-observe`) with `tool.progress` + bounded
  result text back into the same turn (`ai_observe_turn_tail` after the text
  pass; malformed/no tool line → plain text). Driving turns (`drive=1` scope)
  hand `shell:driver = ai:<runId/turn-1>` before the text pass and park
  `exec`/`send_input` as one dispatch-table record (`ai_drive_turn_tail`,
  `approval.request` + `waiting_approval`); the queued human decision resumes
  via `shell_tool_resume` / drops it via `shell_tool_deny` (§6). The manual
  `proposeAi` path (a human types a command *on the AI's behalf*) drives the
  advisory `approvals` queue over the legacy RPCs — offline/test path only.
- **Terminal pane** (right) — human types a command, Enter runs it via
  `@[rpc] exec`. While a command runs, Enter forwards keystrokes to its
  stdin (`send_input`). Output arrives optimistically from the RPC return
  plus once over the room; the frame key dedups the twin.
- **Room protocol** (`shell` room, framed v2, one publish per event):
  `exec\n<cmd>\n<output>` (atomic — a command and its output can never
  interleave with another client's lines), `chat\n<msg>`, `stdin\n<keys>`
  (queued + echoed). Bounded scrollback (200 lines), version-guarded KV tail.
- **Tool layer** (Phase C): `tool_top_commands` (paged,
  caller-filtered, ranked reporting with source IDs), `tool_shorten`,
  `tool_publish_note`, plus the §4 shell-control tools — `tool_shell_exec`
  / `tool_shell_send_input` (side-effect, holder-lease + dispatch-table
  approval gated) and read-only `tool_shell_read_output` (cursor page over
  the same KV scrollback the SSE tail serves). Exercised via
  `GET /api/tools` (`?only=shell_exec` / `?only=shell_read` demo arms) and
  offline + native `v test` suites (`docs/specs/ai.md` §C), and wired to
  the chat path through the per-turn observe/driving tails.
- **Driver lease (§3)**: `shell:driver` (`human` | `ai:<holder>`) +
  `shell:driver:expires` (90 s TTL) in KV, `shell_handoff` / `shell_release`
  RPCs — plus pre-turn handoff in `ai_stream` (contention + expiry checked).
  Human `exec` / `send_input` preempt. Stop press releases.
- **Approval stores, two of them**: shell execution runs on the single
  dispatch-table record (§4) — parked driving calls are decided there by
  `shell_tool_resume` (`approved`) / `shell_tool_deny` (`denied`); the route
  backend still owns the pane-facing `approve` / `deny` RPCs over legacy
  `shell:approval:*` keys (advisory queue for the manual `proposeAi` path
  and for parked-call queue rows); the frontend
  mirrors with `ApprovalStore` (`src/lib/shell.ts`, now also with advisory
  `parseDriver` / `driverHolds`) for instant UI feedback and offline tests.
  Frontend gating is advisory — the backend decides.

## 2. Goal

Let the AI **drive the same terminal the human uses** — run allowlisted
commands, feed stdin to a running program, observe output — through the
Phase C tool loop, while the human keeps complete control whenever the AI
is not in charge:

1. The model receives tool definitions for shell control and
   invokes them (the followup pass sends the per-turn schema and parses
   one adapter-specific `<tool name args>` line).
2. A running command's output reaches the model in a budgeted,
   deterministic form — B for the driving turn, C for re-entry (§5).
3. The human can watch, interrupt, approve/deny, and take the terminal
   back at any point; when the AI is not in charge the terminal behaves
   exactly as the human-only path (zero behavior change).
   Human control holds at all times — exclusive when the AI is not in
   charge, preemptive (interrupt / deny / terminal-input flip) while it
   drives. Stop-press → `shell_release` is wired (§10.2);
   until real identity lands, control rests on the §0 trust note
   (`caller` is client-supplied).

### 2.1 Roadmap: built in order (§10)

Built strictly in build order (§10); every stage's acceptance asserts
pass (27/27 suite):

- **Stage A — provider loop, observe turn (§10.2, fixture 3).** Sends the
  `shell.read_output` (+ reporting tools) schema with the chat turn;
  parses per-adapter tool calls example-locally (the `ai_*_body`
  builders in `+page.v` are local copies, not `@swelte/ai` adapters —
  no framework change); dispatches read-only tools, feeds results back
  into the same turn; `exec` uncallable (not in `allowed`),
  window bounded, cursor advances. Chat pane stays text-first: no
  driver lease, no approval queue change, no terminal mutation.
- **Stage B — provider loop, driving turn (§10.2, fixtures 1–2).**
  Per-turn "let AI use terminal" scope in the send box; `shell_handoff`
  parks `shell:driver = ai:<holder>`; sends all three shell schemas;
  model `exec`/`send_input` calls park `tool.progress(waiting_approval)`
  without holding the SSE stream; human approve/deny via the queue
  (dispatch-table `decide` + dispatch through `shell_tool_resume` /
  `shell_tool_deny`); approved result feeds back into the same turn and
  paints the terminal once; denied/expired → actionable tool error, never
  a hang. Stop-press / terminal-input flip → `shell_release`, in-flight
  call resolves denied/superseded, trace records the cause.
- **Stage C — stdin scope + re-entry (§10.3).** Scoped pre-approval:
  starting `cat` grants that `op_id`'s stdin for the run
  life (dies with turn/flip); transcript-tail injection (last 5
  scrollback lines) on next AI turn after human activity (§5-C).
  `proposeAi` stays as the offline/test path.
- **Stage D — fixtures + budgets (§10.4, fixtures 4–7 + §8).** Human
  reclaims mid-turn (byte-identical human path, re-entry oriented);
  denial/expiry fail-closed; two-tabs single-driver; double-gate
  resume (one record, approve-minutes-later within TTL → same-turn
  feedback, else actionable error); per-turn byte budgets
  (≤256B req / ≤1024B res) and parked-`pending` coverage in the
  suite.

Per-turn handoff first; standing "AI is in charge" sessions reuse the
same primitives with a longer lease only after per-turn works.

## 3. Control model: single driver, explicit handoff

- **One driver at a time.** The terminal has a single driver: `human` or
  `ai`. Default is `human`. The AI drives only after an explicit handoff
  and stops driving on: turn completion, human interrupt (Stop button or
  terminal input while AI drives), denial, expiry, error, or a new human
  command.
- **Handoff granularity: per turn first.** The chat send box gains an
  explicit "let AI use the terminal this turn" scope (UI detail, not
  spec). A standing "AI is in charge" session mode is deferred until
  per-turn handoff works; it reuses the same primitives (driver flag +
  approvals) with a longer lease.
- **Driver is backend state with holder identity.** KV `shell:driver`
  holds `human` (no AI in charge) or `ai:<holder>` where `<holder>` is the
  `runId`/`turnId` that owns the drive (e.g. `ai:run-3/turn-2`). Holder +
  `shell:driver:expires` (unix seconds, turn-scoped, ~60s) so two tabs can
  never both believe they handed control to the AI: a second handoff while
  a live lease holds is rejected. Every AI-originated `exec` / `send_input`
  validates `driver == 'ai:<same holder>'` at the dispatch boundary — same
  stance as approvals: frontend gating is advisory, backend decides. The
  holder travels with the turn; the frontend keeps no copy it trusts.
- **Human input preempts.** Any human terminal submit or Stop press while
  `driver` is `ai:*` flips the driver back to `human`, ends the AI's claim
  on the run, and the in-flight tool call resolves as denied/superseded —
  never executed after the flip.

## 4. Tool surface for shell control

Three tools, all backend-owned (`src/lib/backend/shell_tools.v`), all through
`swelte_tool_dispatch` with a per-run allowlist bound to the AI turn.
Shell execution and approval migrate onto the generated dispatch table:
`shell.exec` is `@[tool('side-effect')]` (one approval record per op — the
existing `shell:approval:*` KV path in `+page.v` `exec` is retired, not
stacked), `shell.read_output` is read-only.

| Tool | Kind | Args | Returns |
| --- | --- | --- | --- |
| `shell.exec` | side-effect (approval-gated) | `{cmd, op_id}` (`op_id` is the approval op id) | `{output, seq}` — same allowlist/dispatch shape as the human `exec` path, executed only after the dispatch-table approval resolves `approved` |
| `shell.send_input` | side-effect (approval-gated, see §6) | `{keys, op_id}` | `{ok}` — queued into the same `shell:stdin:*` KV the human path uses |
| `shell.read_output` | read-only | `{since_seq, limit}` | `{lines: [{seq, kind, text}], next_seq}` — bounded window over the same KV scrollback the SSE tail serves |

- `shell.exec` runs the existing allowlist + `publish_exec` + KV scrollback
  body — same code path the human `exec` RPC uses — but only from inside
  the tool dispatch after (a) the `allowed` per-run check, (b) the holder
  check `driver == 'ai:<holder>'`, and (c) the dispatch-table approval
  (`caller + tool + exact args + op_id`). Tool args carry `op_id`; the
  dispatch-table `caller` is `'ai'`.
- `shell.send_input` reuses `send_input` (op-id dedup, `stdin` echo).
  Whether each keystroke needs fresh human approval is a policy knob
  (§6); the mechanism (record → decide → dispatch → replay) is the
  dispatch-table gate, unchanged.
- `shell.read_output` is the read-only counterpart to the SSE tail: same
  KV keys, same `scroll_cap` bound, `since_seq` cursor so the model pages
  instead of re-reading. Read-only → no approval table touch.
- Per-run selection binds the callable set: an observe-only turn gets
  `[shell.read_output]` (+ reporting tools); a driving turn gets all
  three. Unselected tools have no callable — `selectTools` on the TS side,
  the `allowed` allowlist on the V side.

## 5. How output reaches the model (decision: B + C)

The terminal produces output over time (`cat` waits for stdin; output
arrives in frames); the model consumes discrete tool results. Options:

- **A. Per-line delivery while waiting.** `shell.exec` stays open and the
  backend streams each output line as a `tool.progress` event, final
  `result` on completion. Live but chatty: each line is a model round
  trip; long output breaks the one-call-per-turn budget the reporting
  loop was measured against.
- **B. Settle-then-read.** `shell.exec` returns promptly with
  `{output, seq}` for commands that settle within the handler
  budget (today's `echo/pwd/...` — atomic `exec` frame). For a *running*
  program the tool does not block: `cat` (or any command whose input is
  still open) returns `{pending:true, seq, note}` immediately and the
  output lands in scrollback as `stdin`/`exec` frames arrive; the model
  polls with `shell.read_output{since_seq}` when it needs the output —
  one call per read, bounded by `limit`, cursor-based so re-reads are
  cheap. This requires splitting today's blocking `cat` wait out of the
  exec path (§10.1: non-blocking `cat` start). Output the model never asks
  about costs nothing.
- **C. Given info (context injection).** When the AI was *not* active
  (human ran commands while the model idled), the next AI turn receives a
  compact transcript tail (last N scrollback lines, same bound as the SSE
  tail) injected as turn context — not as a tool result. No polling, no
  extra calls; the model starts oriented.

Recommendation: **B for the driving turn, C for re-entry.** A is
rejected: it couples provider latency to terminal pacing and defeats the
budget discipline. Under B+C the model's shell visibility is always one
of two explicit, bounded shapes — a tool result it asked for, or a cursor
window / transcript tail with a known cap — both reusing the KV
scrollback already bounded by `scroll_cap`.

Invariants whatever is chosen: output is **bounded** (`limit` clamp ≤5
rows/call, same discipline as the reporting loop; each row ≤1024B with
truncation marked), **ordered** (`seq`-keyed, no interleaving inside an
`exec` frame), and **attributed** (every line traces to `exec` vs `stdin`
vs `chat` by frame kind).

`read_output` line shape: one scrollback frame = one row. An
`exec\n<cmd>\n<output>` frame surfaces as `{seq, kind:'exec', text:'$ <cmd>\n<output>'}`
(single row, never split — atomicity preserved); `stdin\n<keys>` as
`{kind:'stdin'}`; `chat\n<msg>` as `{kind:'chat'}`. `since_seq` is the last
`seq` the model has seen (exclusive cursor); `next_seq` is the highest
`seq` returned (== `since_seq` when nothing new). `limit` clamps to 1..5,
default 5. `chat` rows are included — the model sees human chatter in the
tail by design (re-entry orientation), same as the SSE tail.

## 6. Approvals for AI shell actions

- `shell.exec` with dispatch `caller: 'ai'` parks one `pending` record in
  the generated dispatch table (`swelte_tool_approval_record`), bound to
  caller + tool + exact args + op id; nothing runs until the human
  decision is recorded on that record — `shell_tool_resume` records
  `approved` (after holder + expiry re-check) and dispatches once;
  `shell_tool_deny` records `denied` (a late resume then fails closed as
  denied). Denial/expiry/duplicates behave as the `tool_publish_note`
  matrix already proves. There is exactly one record per op — parked calls
  never touch the legacy `shell:approval:*` keys (§4).
- Approval wait vs. turn lifecycle: the provider loop parks the tool call
  and returns a `tool.progress` (`waiting_approval`, with `op_id`) to the
  chat pane without holding the SSE stream open. The wait is bounded by
  the turn lease (90 s TTL — the parked decision resolves while the holder
  still owns the lease; flip/expiry → superseded/denied):
  on approve the result feeds back into the same turn; on deny/expiry the
  model gets an actionable error string (`denied by human` / drive
  superseded), never a hang. The error is a tool result, not a stream abort.
  Op-expiry is lease-driven: the generated gate has no per-op TTL, so a
  lapsed lease fails the resume re-check instead of dispatching.
- `shell.send_input` from the AI: two policies, one mechanism. Default is
  **per-keystroke approval** (safe, annoying). The steady state is
  **scoped pre-approval**: starting `cat` writes the scope row for that
  `exec` `op_id`, granting its stdin for the life of the run (same caller
  + same command lineage), revocable by interrupt. Scoped stdin is an
  explicit, narrow exception to exact-args binding: the dispatch check becomes
  `approved(exec op) AND (stdin op within its scope)` — still backend-owned,
  still replay-safe. The scope (`shell:stdin:scope:<exec op_id>` →
  holder) is recorded in KV alongside the driver lease and goes dead with
  the turn/flip (lazily: rows are never swept, validity is re-checked
  against the live lease at every `send_input`, so a flipped/expired lease
  silently denies).
- Approval UX reuses the existing queue (`approval.request` events mirrored
  into the pane queue, `ApprovalStore`): what changes is *who fills
  it* — provider tool-calls instead of manual `proposeAi`, decided on the
  dispatch-table record via `shell_tool_resume` / `shell_tool_deny` (parked
  calls) or the legacy `approve` / `deny` RPCs (advisory rows for the
  `proposeAi` path). `proposeAi` stays as the offline/test path.
- No standing always-approve switch. Pre-approval is per-run, expires
  with the turn, and never survives a driver flip.

## 7. Human path when AI is not in charge: unchanged

Explicit non-goal guardrail: with `driver == 'human'` (or a live
`ai:<holder>` lease the caller does not own) every byte of
current behavior is preserved — `exec`/`send_input`/`chat` RPCs, room
frames, optimistic paint + dedup, `cat` stdin wait, approval queue
semantics, SSE tail. The AI tools add code paths; they do not alter the
human path. Regression cover: the existing shell suite runs unmodified,
plus a driver-flag test asserting AI-originated calls fail closed when
the caller does not hold the lease (`driver != 'ai:<holder>'`).

Stdin-queue sharing note: `shell:stdin:*` is one global FIFO today. Human
and AI keystrokes share it; a preempted AI's un-drained keys are *not*
retroactively pulled — `cat` drains what is queued. Post-flip the backend
tags further AI `send_input` as denied (traced), so only keys queued before
the flip can still drain.

The human also gains *observation* for free: the terminal already renders
every `exec`/`stdin` frame, so an AI-driven session paints in the same
pane the human watches — no separate "AI view" to build. The chat pane's
`tool.progress` rows narrate what the model does; the terminal pane shows
what actually happened. Disagreement between the two is itself a signal
(worth a trace event, §8).

## 8. Observability

Every AI shell turn records into the existing trace sink. Frontend events
(`RunTracker` + `createMemorySink`: run/turn/output ids, tool decisions,
driver flips with cause) stay frontend-owned — the backend has no trace
emitter. Backend-side facts (dispatch allow/deny, approval decisions, lease
flips, late-result-after-flip rejections) travel as `tool.progress` /
`approval.request` pane events over the existing SSE stream, so the trace
is assembled where the sink lives. Interrupt keeps Phase B semantics:
ending one output leaves others active until the run's terminal event; a
late tool result after a driver flip is rejected and traced, never applied.
Measure per turn: tool calls (settle-then-read keeps `exec` + at most one
`read_output` per needed window), request/response bytes against the §C
budgets (≤256B req / ≤1024B res per call), and human wait time per approval
(time parked `pending`). Flip causes: `handoff` / `interrupt` / `deny` /
`expiry` / `error` / `turn-end`.

## 9. Acceptance fixtures

1. **AI runs a command, human approves.** Turn scoped to terminal use;
   model calls `shell.exec{cmd:'pwd'}`; pane shows `approval.request`;
   human approves; output paints in terminal + returns to model; model
   answers with the result. Assert: one approval record, exact-args
   binding, no execution before approval, terminal shows the frame once.
2. **AI feeds stdin.** `cat` running under AI drive; model calls
   `shell.send_input{keys}` under scoped pre-approval; output returns;
   human interrupts mid-wait → driver flips, pending input resolves
   denied, `cat` drains with what it has. Assert: no keystroke executes
   after the flip; trace shows the flip cause.
3. **AI observes only.** Read-only turn (`shell.read_output` +
   `tool_top_commands` selected); model pages scrollback with
   `since_seq`, never touches `exec`. Assert: `exec` uncallable
   (not in `allowed`), output window bounded, cursor advances.
4. **Human reclaims mid-turn.** AI driving, human types in terminal →
   driver flips to `human`, in-flight tool call denied, human command
   runs normally, next AI turn receives transcript tail (option C).
   Assert: human path byte-identical to today; model re-entry oriented.
5. **Denial and expiry.** Human denies an AI `exec`; op expires while the
   model waits. Assert: fail-closed both times, model gets an actionable
   error (not a hang), no partial side effect, denial traced.
6. **Two tabs, one driver.** Handoff in tab A, AI call from tab B's
   session → rejected at the boundary (`driver` is backend state).
   Assert: single-driver invariant holds across clients.

## 10. Build order (all done — 27/27)

- [x] 1. `shell.exec` / `shell.send_input` / `shell.read_output` as `@[tool]`
   fns in `src/lib/backend/shell_tools.v` over the existing allowlist /
   `send_input` / scrollback bodies (§4: driver KV keys `shell:driver` +
   `shell:driver:expires`, holder-bound boundary checks, single dispatch-table
   approval, non-blocking `cat` start) + §3/§7 regression tests (human path
   unmodified; AI calls fail closed without the holder lease).
- [x] 2. Provider loop in `ai_stream_run`: send selected tool schemas, parse
   tool calls per adapter *example-locally* (the `ai_*_body` builders in
   `+page.v` are local copies, not `@swelte/ai` adapters — no framework
   change; see `docs/specs/ai.md` §C portability note), dispatch → parked
   approval (`record` + pane queue row + `approval.request`) → human decides
   via `shell_tool_resume` / `shell_tool_deny` → dispatch once → feed back →
   terminal. Read-only observe turn first (fixture 3), then driving turn
   (fixtures 1–2).
- [x] 3. Scoped stdin pre-approval + transcript-tail re-entry (§6, §5-C —
   Stage C done).
- [x] 4. Fixtures 4–7, budgets into the suite (§8 — Stage D done).

New fixture 7 (double-gate / resume): AI `exec` parks exactly one dispatch-table
record; human approves minutes later (within turn TTL) → result feeds back into
the same turn; expired/denied → actionable tool error, no partial side effect,
denial traced. Assert single record, no `shell:approval:*` write, resume or
error (never hang).

Out of scope: standing AI-in-charge sessions (same primitives, longer
lease — after per-turn works); multi-model or multi-terminal
arbitration; anything outside `examples/shell` (no framework API).
