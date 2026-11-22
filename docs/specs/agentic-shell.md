# Agentic shell: AI driving the shell example's terminal

Status: proposed. Scope: `examples/shell` only — a consumer of `@swelte/ai`,
never a framework surface. Decisions made here may later graduate into
framework guidance, but nothing in this spec adds API to `@swelte/ai`,
`@swelte/core`, or `@swelte/plus`.

## 1. What exists today

One allowlisted backend shell (`echo pwd whoami help cat`) shared by two
faces on `/` (`examples/shell`):

- **Chat pane** (left) — streams provider text (`text.delta` → `terminal`
  over `POST ?q=ai_stream`), renders thinking/tool/approval rows, keeps an
  approval queue. The model never calls tools: `ai_stream_run`
  (`src/routes/+page.v`) sends `{prompt, model, system, temperature}` to
  the provider and relays text deltas. `tool.progress` / `approval.request`
  rendering exists in the pane but only ever fires from the manual
  `proposeAi` path (a human types a command *on the AI's behalf*).
- **Terminal pane** (right) — human types a command, Enter runs it via
  `@[rpc] exec`. While a command runs, Enter forwards keystrokes to its
  stdin (`send_input`). Output arrives optimistically from the RPC return
  plus once over the room; the frame key dedups the twin.
- **Room protocol** (`shell` room, framed v2, one publish per event):
  `exec\n<cmd>\n<output>` (atomic — a command and its output can never
  interleave with another client's lines), `chat\n<msg>`, `stdin\n<keys>`
  (echo only). Bounded scrollback (200 lines), version-guarded KV tail.
- **Tool layer** (Phase C, proven but unwired to the chat path):
  `tool_top_commands` (paged, caller-filtered, ranked reporting with
  source IDs), `tool_shorten`, and the side-effect `tool_publish_note`
  behind the dispatch-boundary approval gate. Exercised via
  `GET /api/tools` and offline + native `v test` suites
  (`docs/specs/ai.md` §C).
- **Approval stores, two of them**: the route backend owns authoritative
  approval records (KV, decision bound to caller + tool + exact args + op
  id, expiry, no re-execution); the frontend mirrors with `ApprovalStore`
  (`src/lib/shell.ts`) for instant UI feedback and offline tests.
  Frontend gating is advisory — the backend decides.

## 2. Goal

Let the AI **drive the same terminal the human uses** — run allowlisted
commands, feed stdin to a running program, observe output — through the
Phase C tool loop, while the human keeps complete control whenever the AI
is not in charge. Concretely:

1. The model receives tool definitions for shell control and actually
   invokes them (closing today's gap: manifest never sent, tool calls
   never parsed).
2. A running command's output reaches the model in a budgeted,
   deterministic form — this spec's main open decision (§5).
3. The human can watch, interrupt, approve/deny, and take the terminal
   back at any point; when the AI is not in charge the terminal behaves
   exactly as today (zero behavior change for the human-only path).

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
- **Driver is backend state.** The frontend toggle is a request; the route
  backend owns the driver flag (KV, like approvals) so two tabs cannot
  both believe they handed control to the AI. Every AI-originated `exec`
  / `send_input` validates `driver == 'ai'` at the dispatch boundary —
  same stance as approvals: frontend gating is advisory, backend decides.
- **Human input preempts.** Any human terminal submit or Stop press while
  `driver == 'ai'` flips the driver back to `human`, ends the AI's claim
  on the run, and the in-flight tool call resolves as denied/superseded
## 4. Tool surface for shell control

Three tools, all backend-owned, all through `swelte_tool_dispatch` with a
per-run allowlist bound to the AI turn:

| Tool | Kind | Args | Returns |
| --- | --- | --- | --- |
| `shell.exec` | side-effect (approval-gated) | `{cmd, op_id}` | `{output, seq}` — same `ExecResult` the human path returns |
| `shell.send_input` | side-effect (approval-gated, see §6) | `{keys, op_id}` | `{ok}` — queued into the same `shell:stdin:*` KV the human path uses |
| `shell.read_output` | read-only | `{since_seq, limit}` | `{lines: [{seq, kind, text}], next_seq}` — bounded window over the same KV scrollback the SSE tail serves |

- `shell.exec` reuses the existing `exec` RPC body (allowlist, approval
  record, `publish_exec`, KV scrollback). The tool is a thin dispatch
  entry over it — not a second implementation.
- `shell.send_input` reuses `send_input` (op-id dedup, `stdin` echo).
  Whether each keystroke needs fresh human approval is a policy knob
  (§6); the mechanism (record → decide → dispatch → replay) is unchanged.
- `shell.read_output` is the read-only counterpart to the SSE tail: same
  KV keys, same `scroll_cap` bound, `since_seq` cursor so the model pages
  instead of re-reading. Read-only → no approval table touch.
- Per-run selection binds the callable set: an observe-only turn gets
  `[shell.read_output]` (+ reporting tools); a driving turn gets all
  three. Unselected tools have no callable — `selectTools` on the TS side,
  the `allowed` allowlist on the V side.

## 5. How output reaches the model (open decision)

The terminal produces output over time (`cat` waits for stdin; output
arrives in frames); the model consumes discrete tool results. Options:

- **A. Per-line delivery while waiting.** `shell.exec` stays open and the
  backend streams each output line as a `tool.progress` event, final
  `result` on completion. Live but chatty: each line is a model round
  trip; long output breaks the one-call-per-turn budget the reporting
  loop was measured against.
- **B. Settle-then-read (recommended).** `shell.exec` returns promptly
  with `{output, seq}` for commands that settle within the handler
  budget (today's `echo/pwd/...` — atomic `exec` frame). For a *running*
  program, the tool returns `{pending, seq}` and the model polls with
  `shell.read_output{since_seq}` when it needs the output — one call per
  read, bounded by `limit`, cursor-based so re-reads are cheap. Output
  the model never asks about costs nothing.
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

Invariants whatever is chosen: output is **bounded** (`limit` clamp, ≤5
## 6. Approvals for AI shell actions

- `shell.exec` with `caller: 'ai'` keeps today's rule: every command parks
  a `pending` record; nothing runs until the human approves the exact
  `(tool, args, op_id)` triple at the dispatch boundary. Denial/expiry/
  duplicates behave as the `tool_publish_note` matrix already proves.
- `shell.send_input` from the AI: two policies, one mechanism. Default is
  **per-keystroke approval** (safe, annoying). The intended steady state is
  **scoped pre-approval**: approving an `exec` optionally grants that
  `op_id`'s stdin for the life of the run (same caller + same command
  lineage), revocable by interrupt. The dispatch check becomes
  `approved(exec op) AND (stdin within its scope)` — still backend-owned,
  still replay-safe.
- Approval UX reuses the existing queue (`approve`/`deny` RPCs,
  `approval.request` events, `ApprovalStore`): what changes is *who fills
  it* — provider tool-calls instead of manual `proposeAi`. `proposeAi`
  stays as the offline/test path.
- No standing always-approve switch. Pre-approval is per-run, expires
  with the turn, and never survives a driver flip.

## 7. Human path when AI is not in charge: unchanged

Explicit non-goal guardrail: with `driver == 'human'` every byte of
current behavior is preserved — `exec`/`send_input`/`chat` RPCs, room
frames, optimistic paint + dedup, `cat` stdin wait, approval queue
semantics, SSE tail. The AI tools add code paths; they do not alter the
human path. Regression cover: the existing shell suite runs unmodified,
plus a driver-flag test asserting AI-originated calls fail closed when
`driver != 'ai'`.

The human also gains *observation* for free: the terminal already renders
every `exec`/`stdin` frame, so an AI-driven session paints in the same
pane the human watches — no separate "AI view" to build. The chat pane's
`tool.progress` rows narrate what the model does; the terminal pane shows
what actually happened. Disagreement between the two is itself a signal
(worth a trace event, §8).

## 8. Observability

Every AI shell turn records into the existing trace sink: run/turn/output
ids, the selected tool set, each tool decision (`allowed`/`denied`/
`executed` with op id), driver flips with cause
(handoff/interrupt/deny/expiry), provider usage, terminal outcome. The
interrupt case keeps the Phase B semantics: ending one output leaves
others active until the run's terminal event; a late tool result after a
driver flip is rejected and traced, never applied. Measure per turn: tool
calls (settle-then-read keeps `exec` + at most one `read_output` per
needed window), request/response bytes against the §C budgets (≤256B req
/ ≤1024B res per call), and human wait time per approval (time parked
`pending`).

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

## 10. Build order

1. `shell.exec` / `shell.send_input` / `shell.read_output` as `@[tool]`
   fns over the existing `exec`/`send_input`/scrollback bodies (§4) +
   driver flag in KV with boundary checks (§3, §7 regression test).
2. Provider loop in `ai_stream_run`: send selected tool schemas, parse
   tool calls per adapter, dispatch → approval → feed back → terminal.
   Read-only observe turn first (fixture 3), then driving turn
   (fixtures 1–2).
3. Scoped stdin pre-approval + transcript-tail re-entry (§6, §5-C).
4. Fixtures 4–6, budgets into the suite (§8).

Out of scope: standing AI-in-charge sessions (same primitives, longer
lease — after per-turn works); multi-model or multi-terminal
arbitration; anything outside `examples/shell` (no framework API).

rows/call discipline from the reporting loop), **ordered** (`seq`-keyed,
no interleaving inside an `exec` frame), and **attributed** (every line
traces to `exec` vs `stdin` vs `chat` by frame kind).

  — never executed after the flip.
