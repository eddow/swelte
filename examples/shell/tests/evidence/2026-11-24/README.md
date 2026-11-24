# Shell usability evidence — 2026-11-24

Scope: working-tree implementation of [shell-console contract](../../../../../openspec/specs/shell-console/spec.md).
No commit was made. Live-certified pair: **OpenRouter / `openai/gpt-4o-mini`**,
provider-default generation settings. OpenAI Responses and Anthropic passed
wire-shaped fixtures only; their live behavior remains uncertified.

## Final live acceptance

[Machine-readable 40-sample record](shell-live-evidence-2026-11-24.json)
contains every prompt, answer, execution/request count, elapsed time, terminal
reason and failure list. Twenty S1 and twenty S2 samples were evenly split
between clean and reconstructed existing conversations, across two independent
native process starts. Both starts served backend source fingerprint
`0c43d9e37d27cc65aec715e59f216e454e4f1643e4eedb807410bcc3d5b8bd6e`.
UI bundle: `assets/index-DyNXLh4L.js`, SHA-256
`ff104b1f377180fba129c62c5a1f8707b530ef8c4477ff8e201a18843d833637`.

- S1: **20/20 pass**, p50 1.519 s, p95 2.002 s, max 2.208 s; exactly one
  tool execution and two model requests per sample, inside the 15 s deadline.
- S2: **20/20 pass**, p50 4.421 s, p95 5.133 s, max 5.216 s; exactly two
  tool executions and three model requests per sample, inside the 25 s deadline.
- Zero recorded sample failures, unwanted approvals, duplicate executions or
  raw protocol leaks. The live harness requires all samples to pass.

[Real Chrome/live-provider record](shell-live-browser-evidence-2026-11-24.json):
**8 scenarios pass** on the same backend fingerprint. Cwd, location plus contents,
and a subsequent cwd question render grounded answers; approved command and
HTTPS read resume with real output; Stop settles in **9 ms**; another question
works after Stop; human `cd src` is reflected by a fresh cwd question. Browser
UI expectation matches the backend source hash; no active rows remain.

The original runtime/configuration and full conversation are unavailable.
Existing-session tests reconstruct only the supplied incident messages. This
is evidence against that failure class, not an exact replay of the incident.

## Deterministic and rendered regression proof

`npm run test:regression`: **5 suites pass** against the compiled native server
and production UI. `npm test`: **31 unit tests pass**. `npm run check`: clean,
no warnings. Production build passes. Core development lifecycle tests:
**21 pass**; core TypeScript build passes.

- `agent.integration.mjs`: S1/S2, repeated-read budgets, revision invalidation
  after approved `cd`, typed errors, native-safe aliases and strict result wires
  for all three adapters. Changed arguments/holder rejected; concurrent approval
  dispatches once; receipt replay, denial, true TTL lapse and human preemption
  fail closed. Actual kill/restart rotates boot, rejects an original unapproved
  pending operation and an intact unused old continuation; completed receipt
  replays from KV without redispatch. Concurrent continuation starts one model
  loop and restores saved provider/model despite changed client settings.
- `browser.cdp.mjs`: real approval queue/exact arguments, approved completion,
  pending Stop, next turn, revision badge and clean reconnect.
- `browser.lifecycle.mjs`: actual per-call completion and provider failure,
  controlled SSE replay/disconnect, Stop during model/tool/final phases,
  completed rows surviving interruption, and late model packets ignored.
  Delayed approval acknowledgement after Stop cannot start a continuation.
  Two real tabs exercise driver contention and human preemption; terminal
  output appears in both. Two identical real commands remain two output rows
  after reconnect. Zero captured browser runtime exceptions.
- Foreground receipt-to-next-render checks use `performance.now()` at SSE
  receipt and `requestAnimationFrame` to observe the settled row. Recorded
  regression runs measured approximately **11–35 ms**, below the 250 ms gate.
  This is foreground headless Chrome evidence, not a background-tab guarantee.
- `recovery.integration.mjs`: a 350 ms test budget bounds an intentionally
  1.5-second provider response to <800 ms; no late tool dispatch. Explicit
  release preempts a pending model request; lease contention and human takeover.
- `select.integration.mjs`: a compiled POSIX C probe repeatedly interrupts
  socket waits with signals. Read readiness still succeeds and a 100 ms timeout
  remains bounded. The shim retries only the interrupted wait, never an HTTP
  request or a tool execution.

Short synchronous tool/final phases are held open using controlled SSE in the
production UI reducer. These reproducible phase tests are distinct from the
live-provider Stop scenario. Stop cannot undo an already executed approved
command; its stored receipt remains authoritative.

## Development reload

[Three-cycle machine record](shell-dev-reload-evidence-2026-11-24.json).
**All three cycles pass**, including browser revision agreement, exactly one
replayed terminal output per cycle and zero active tool rows.
The isolated harness leaves the dev process open during production builds,
then edits backend source and checks changed source fingerprint/boot. Browser
checks additionally require matching expected/backend revision, one terminal
output after reconnect and no active tool rows. The harness copies no `.env`,
uses temporary databases/profiles and does not alter the user's app.

## Fixes and failed attempts resolved

Earlier intermediate runs are not acceptance of the final build:

- Terminal events were nested under approval handling; normal completion looked
  like disconnection and Stop left unfinished rows. Terminal handling is now
  separate, and all failure/interruption paths settle only unfinished rows.
- Old conversation file requests caused unnecessary reads on a new cwd question;
  one live sample answered an old cwd without a fresh read. Latest-task scope
  and native first-read/final-answer constraints resolved these failures.
- Browser/live requests exposed V's TLS `select` EINTR early return; backend-only
  live requests missed it. A bounded POSIX wait shim and HTTP/1.1 transport
  resolve the tested browser flow. Request watchdogs detach late responses.
- Valid HTTPS URLs were rejected because V's parser supplies empty user-info.
  Validation now checks the authority for credentials, including empty `@`.
- Vite treated revision-module watched backend files as browser imports.
  Explicit server watching replaces that Rollup dependency registration.
- The reload harness initially placed Chrome cache/database files inside the
  watched project and used a non-allowed loopback origin. Its resources now
  live outside the project, and it uses the advertised `localhost` origin.

## Boundaries

This is one trusted local process, not authenticated multi-user authorization
or a multi-process lease service. Pending operations are restart-invalidated;
successful receipts persist in KV. HTTPS reads are approval-gated, bounded text
fetches without redirects/cookies/JavaScript; they can reach server-accessible
networks. No unrestricted bash execution or interactive browsing was added.
