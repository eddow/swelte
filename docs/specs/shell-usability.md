# Shell usability roadmap and acceptance gates

Status: proposed recovery plan; **the shell is not usability-accepted**.
Updated: 2026-11-23. Scope: `examples/shell`, its provider loop, console UI,
tool dispatch, human control and development reload path. Framework changes
belong here only when they are required to make this consumer reliable.

This document defines intended behavior and evidence required to claim it.
It does not certify the current implementation. Passing unit tests, a scripted
provider fixture, a successful build, or one successful live turn does not
establish usable agent behavior.

## Starting evidence

The user has reported these failures in the same console integration:

- Tool names and JSON appear in the assistant answer instead of executing.
- Model progress appears as a tool call (`Thinking`, `model-0`).
- A simple working-directory question asks for a terminal toggle.
- After fixes and individual successful probes, `what is your pwd ?` still
  produces six “Inspect the console” rows marked “running”, takes 29 seconds,
  and ends with “Interrupted” instead of answering.

The latest report is the blocking regression. Six visible rows do not by
themselves prove six backend executions: execution counts, model requests,
results delivered to the model, and UI updates must be measured separately.
Do not assign a root cause from the screenshot alone.

The current source has an eight-step provider loop, a text-based tool protocol,
read-only console queries, approval-gated actions, SSE events, and a shared
console. These mechanisms exist, but their composition has not met this spec.
The loop currently appends results to a text prompt, and tool rows are normally
settled at turn end rather than at the actual completion of each call. Both
paths require investigation before another claim of completion.

## Product contract

A user can ask an ordinary console question and get a short, grounded answer.
The agent uses the minimum operations needed, reports each operation honestly,
and stops once the task is answered. The user should not have to understand
provider protocols, driver leases or tool identifiers.

Read-only inspection (`pwd`, `whoami`, `help`, `ls [path]`) is available without
an action toggle or approval. Other actions follow an explicit backend policy;
read-only permission must never silently expand into `cd`, stdin, file writes,
arbitrary shell execution, or web access. Current supported commands and the
HTTPS-reader limits must remain accurately described in the example README.
This roadmap does not authorize adding an unrestricted OS shell or full browser.

## Success markers

All markers below are targets, not claims of present behavior. Count actual
backend starts, not rendered rows. Timing starts when the user submits and
excludes application startup. Measure with a monotonic clock.

### S1 — A working-directory question finishes

Reproduce with both `what is your pwd ?` and `Where is our console?`:

- Exactly one successful working-directory read; no other tool is necessary.
- At most two model requests: choose the read, then answer from its result.
- The answer contains the actual canonical cwd, matching the backend console.
- No toggle request, approval request, repeated inspection or manual Stop.
- One readable tool row, such as “Read working directory”, reaches `done`
  when the read returns, even if the model is still composing its answer.
- No tool syntax, internal module names, JSON, holder IDs or operation IDs in
  the ordinary answer or default tool-row presentation.
- One successful turn terminal event; no remaining “running” rows.

For deterministic provider fixtures, answer within one second after submission.
For the live supported provider/model matrix, target p95 at most ten seconds
and enforce a fifteen-second total deadline for this simple question. A deadline
failure is a failed run, not a reason to loosen the target without review.

### S2 — Location and contents require no repetition

For `Where are we and what files are here?`:

- One cwd read and one directory listing, each executed once.
- At most three model requests with sequential calls; fewer are acceptable
  when the provider supports a correctly handled batch.
- The final answer uses both actual results and lists a few real entries.
- No repeated read of unchanged state and no generic history lookup in place
  of inspecting the current console.
- Both rows finish independently; the final answer and turn settle normally.

For deterministic fixtures, answer within one second. For the live supported
provider/model matrix, target p95 at most fifteen seconds and enforce a
twenty-five-second total deadline for this two-read task.

### S3 — Follow-ups observe current state

After a human changes cwd, another `pwd` returns the new directory. Cached
results must be invalidated by relevant console state changes. A duplicate
within one unchanged turn must not create another execution or another row.
A new user question is not a replay of an earlier turn.

### S4 — Tool and turn states are honest

The UI distinguishes model work, tool execution, waiting for approval, and
final-answer generation. Thinking is never counted as a tool call.

Each call has a stable ID and a lifecycle: requested → running → succeeded,
failed, denied, expired, or cancelled. Approval waiting precedes execution;
it is not “running”. These conceptual states may map to existing wire types,
but the mapping must be explicit and tested.

A success or failure event settles its row within 250 ms of receipt in a
foreground browser. No terminal turn can retain running rows. Successful calls
remain successful when a later model request fails or the user presses Stop;
completed work must not be retroactively labelled interrupted or failed.
Repeated progress delivery updates the same row. Two legitimate calls with
the same description remain distinct and do not cause duplicate-key errors.
Raw payloads may be available in an explicitly expanded diagnostic view.

### S5 — Approval is necessary only where policy requires it

- Read-only inspection never depends on acquiring a driver lease.
- An action executes zero times before approval, and once after approval.
- Approval binds caller, tool, exact validated arguments, operation ID and
  applicable driver lease. Changed arguments or holder identity are rejected.
- Denied, expired or superseded actions execute zero times. The model does not
  retry them under another name or through the human execution RPC.
- Duplicate decisions, concurrent decisions and lost acknowledgements cannot
  execute an action again. A replay returns its existing receipt.
- An approved result resumes the task without losing the original request,
  changing its provider configuration unexpectedly, or reopening the same
  approval. Repeated continuation requests cannot start duplicate agent loops.
- Pending operations fail closed after restart; receipts and UI recovery have
  documented lifetimes. Two tabs cannot both own an active driving lease.

The local shared-console trust model remains explicit. Caller strings supplied
by a model or client are not authenticated user identities.

### S6 — Stop and failures finish predictably

Stop visibly settles the turn within 500 ms, releases human control, and
prevents later packets from updating that turn. In-flight provider requests
are aborted where supported; otherwise their late results are detached and
ignored, with a bounded request timeout. No new tool starts after cancellation
or after human preemption; action authorization is rechecked at execution.

Automatic timeouts, exhausted budgets and no-progress detection produce a
brief actionable failure, never a fabricated answer or a perpetual spinner.
“Interrupted” is reserved for actual interruption, not ordinary completion.
If some work succeeded, the UI preserves its receipt and explains what remains.
A failed turn must not block the next human command or chat turn.

### S7 — Development serves the tested revision

The dev backend and UI expose a comparable build/revision identifier in a
read-only diagnostic surface. Before a live acceptance run, record both and
verify they match the source under test. A failed reload is visible rather
than silently retaining an apparently current backend.

Run a production build while dev is open, then change a backend source file.
Dev must recover its temporary executable directory, reload successfully, and
serve the new revision without manual directory repair. Verify this across
three consecutive rebuild/reload cycles. The browser must reconnect without
duplicating terminal frames or leaving tool rows running.

## Ordered implementation roadmap

Milestones are deliberately unchecked. Complete them in order; document any
exception and its evidence rather than treating earlier smoke tests as proof.

### P0 — Reproduce and measure the failing turn

- [ ] Preserve the reported `pwd` conversation as a regression scenario,
  including preceding messages, selected model/configuration, toggle state,
  browser state, active backend revision and the final interruption.
- [ ] Add correlated run, turn, model-request and tool-call IDs to diagnostics.
  Record requested tool, normalized arguments hash, console-state revision,
  actual execution start/end, result receipt, result delivered to the model,
  UI state transitions, cancellation and terminal reason with timings.
- [ ] Keep keys and credentials out of diagnostics. Record prompt/result bodies
  only with explicit diagnostic opt-in and redaction; metadata is the default.
- [ ] Distinguish six model decisions, six dispatches, repeated SSE delivery,
  and six UI rows. Identify where useful progress stops.
- [ ] Add a reproducible test that fails on the reported loop or state mismatch.

Exit: one trace explains the failing sequence, and a regression detects it.
A request timeout or a test that mirrors a handwritten parser is not sufficient.

### P1 — Make inspection bounded and result-aware

- [ ] Give ordinary read-only questions a direct inspection path with clear
  command-specific labels and authoritative results.
- [ ] Canonicalize tool identity and typed arguments before dispatch. Within a
  turn and unchanged console revision, reuse an identical completed read.
- [ ] After a sufficient read, require a final answer rather than allowing
  unlimited inspection. A repeated identical request does not restart work:
  return the existing result and allow one answer-only model attempt, then
  finish with a concise failure or an explicitly attributed console result.
- [ ] Bound total wall-clock time, model requests, tool starts, repair attempts
  and no-progress retries independently. Eight iterations is a ceiling, not
  permission to spend eight calls answering `pwd`.
- [ ] Ensure only executed calls and their corresponding results enter history;
  unexecuted batch entries must not be described as completed.
- [ ] Test S1–S3 against the actual backend and model request payloads.

Exit: S1 and S2 pass with adversarial fixtures that repeatedly ask for the same
read, ignore a result, emit multiple requests, or return malformed output.

### P2 — Make tool transport a typed contract

- [ ] Use provider-native structured tool calls where the adapter/model supports
  them, including native call IDs and corresponding result messages. Keep
  provider translation outside the console UI.
- [ ] Select supported tool-capable models explicitly. An unsupported model gets
  a clear capability error or a documented bounded fallback before a run.
- [ ] If a text fallback remains, specify its grammar, normalization and single
  bounded repair. Cover canonical, shortened, bare and fenced requests,
  multiline JSON, escaped quotes, multiple calls, and invalid output.
- [ ] Reject invalid or unavailable operations before execution. Never render
  protocol fragments as a successful assistant answer or recursively repair
  without a deadline. Preserve tool errors as errors, not success-shaped text.
- [ ] Prove adapter conformance through actual wire requests and responses,
  including result delivery, rather than only final-text response fixtures.

Exit: each supported adapter passes identical semantic scenarios by changing
only provider configuration. Parser tolerance alone cannot close this milestone.

### P3 — Tie presentation to execution lifecycle

- [ ] Emit start and completion/failure events at the actual dispatch boundary,
  correlated by stable call ID. Model progress uses its own event/state.
- [ ] Update rows per call, not only when the whole turn ends. Track pending
  approval separately and retain completed receipts after Stop or errors.
- [ ] Show a specific short description, such as “Read working directory”,
  “List project files” or “Read a web page”. Keep raw protocol in diagnostics.
- [ ] Verify real rendered UI for event replay, repeated descriptions,
  approval/resume, disconnect, cancellation and provider failure.

Exit: S4 passes in browser tests; screenshots alone and backend-only tests do
not demonstrate event lifecycle correctness.

### P4 — Prove human control and recovery

- [ ] Exercise all S5 binding, replay, concurrency, denial, expiry and restart
  scenarios against the backend rather than an advisory frontend store.
- [ ] Exercise S6 with Stop during model work, a running tool, approval waiting,
  approval resume and final-answer generation. Include human input from another
  tab and late provider packets after interruption.
- [ ] Fix and test the build/dev coexistence failure described in S7.
- [ ] Verify shared transcript, cwd and terminal output stay consistent after
  reload/reconnect; distinguish this local sharing from user authentication.

Exit: S5–S7 pass, including browser assertions and actual execution counts.

### P5 — Accept usability through repeated live runs

- [ ] Run the acceptance pack below on declared supported provider/model pairs.
- [ ] Publish a dated evidence record with source and runtime revisions,
  configuration, repetitions, latency distribution, model requests, backend
  executions, approval counts, row outcomes and final answers.
- [ ] Repeat the original reported conversation in the actual console, not
  only an isolated prompt or a newly created clean session.
- [ ] Mark individual markers accepted only with linked evidence. Any recurrence
  of an unexplained loop, raw protocol leak, unauthorized action, or stale
  running row reopens the relevant marker and blocks overall acceptance.

Exit: all required markers pass. Do not describe the shell as fixed based on
one live success or an unrelated passing test count.

## Acceptance pack and evidence rules

Use four layers of evidence:

1. **Deterministic backend tests:** actual dispatch, result feedback, loop
   budgets and authorization. Include a provider fixture that requests `pwd`
   repeatedly even after receiving its result. Assert backend execution count,
   model-request count, terminal reason and answer, not just rendered text.
2. **Adapter conformance:** real provider-shaped tool calls and result messages
   for OpenRouter, OpenAI Responses and Anthropic, including error and partial
   response paths. Fixture success establishes protocol handling, not live
   model reliability.
3. **Browser tests:** submit, observe individual row completion, approve/deny,
   interrupt, reconnect and retry. Assert no stale running rows, no technical
   noise in the default view, and no duplicate frames.
4. **Live usability runs:** pin provider and model identifiers, include the
   default selected configuration, and run both a clean session and the
   reported multi-turn conversation. Report each supported combination
   separately; unsupported or untested combinations stay explicitly unaccepted.

For each supported provider/model pair, collect at least 20 S1 runs and 20 S2
runs, split evenly between clean and existing conversations, with at least two
independent application starts. Report sample count, p50/p95/max latency and
all failures. Initial release target: at least 95% grounded completion within
the scenario's budget, zero repeated executions of an unchanged read within
a turn, zero raw protocol leaks, zero unauthorized actions, and zero stale
running rows after a terminal event. Every observed failure needs a trace and
a disposition; the original reported scenario must pass before acceptance.

Include these scenarios in the pack:

- `what is your pwd ?`, then a paraphrase in the same conversation.
- `Where are we and what files are here?`, with known fixture entries.
- Human `cd` followed by another `pwd`; ensure the result is current.
- Tool toggle off/on; inspection works in both, other action policy is intact.
- Model requests the same read six times; execution is deduplicated and the
  turn ends within its budget instead of depending on the user pressing Stop.
- Approve once, duplicate approval, concurrent approval, changed arguments,
  denied action, expired lease, lost acknowledgement and restart.
- Provider timeout/error, malformed request, invalid arguments, unavailable
  tool, multiple requests, repeated SSE frames and disconnect mid-result.
- Stop in each phase; new chat and terminal input immediately afterwards.
- A production build followed by dev edits and browser reconnect.
- Approved HTTPS read, invalid URL, failed fetch and denial; never describe an
  HTTP reader as an interactive browser or failed content as successfully read.

Store evidence alongside the spec in a dated companion file when produced.
Until that evidence exists, the roadmap remains open.

## Relevant implementation and related plans

- [Shell example and supported capabilities](../../examples/shell/README.md)
- [Provider loop and approval endpoints](../../examples/shell/src/routes/+page.v)
- [Frontend stream handling and cancellation](../../examples/shell/src/routes/+page.svelte)
- [Tool implementations](../../examples/shell/src/lib/backend/shell_tools.v)
- [Filesystem console](../../examples/shell/src/lib/backend/shell_fs.v)
- [Compiled-backend fixture tests](../../examples/shell/tests/agent.integration.mjs)
- [AI package and provider roadmap](ai.md)

Earlier completed checkboxes in broader AI plans describe implementation
milestones. They must not be read as acceptance of the shell's current
end-to-end usability; this document owns that gate.
