# Provider abstraction and multimodal AI sessions

`@swelte/ai` is intended to do for model providers what an ORM does for databases. An application describes a run once and consumes a common event stream. A provider adapter translates that request into the provider’s API and translates its responses back into Swelte events. Just as an ORM can target PostgreSQL or MySQL, the intended adapter family includes OpenRouter, direct OpenAI, direct Anthropic and other providers. Applications choose a provider and model at configuration time. Each adapter advertises its capabilities so a run can require features such as tool calls or structured output.

**Implemented in `engine/ai` today:** the TypeScript `AiAdapter.run(input, requirements)` contract accepts a text string and returns an asynchronous stream of `WireEvent` values. `routeAdapter` selects among supplied candidates using capabilities and configured latency and cost estimates. The deterministic adapter supports offline tests. OpenRouter is the first network adapter and translates streamed text, token usage and completion into Swelte events. Its tests use an injected HTTP transport. [Adapter contract and routing](../../engine/ai/src/lib/adapters.ts) · [OpenRouter implementation](../../engine/ai/src/lib/openrouter.ts) · [Adapter tests](../../engine/ai/src/lib/openrouter.test.ts)

**Portability still to prove:** direct OpenAI and Anthropic adapters are future targets. Selecting a model through OpenRouter exercises the OpenRouter API. The proposed native V provider interface, multi-turn and multimodal requests, and provider-independent cancellation still need implementation. For example, the OpenRouter adapter accepts an abort signal today through an adapter-specific third argument. The acceptance test for a second provider is to run the same text consumer against two distinct provider protocols by changing only the adapter configuration, and verify text deltas, usage when available, cancellation and terminal outcomes.

The shell's provider loop lives in the consumer (`examples/shell/`), not the
framework adapter contract. It currently uses an example-local text tool
protocol, dispatches through the generated tools table, and appends bounded
results to subsequent model prompts. Read-only queries have no driver lease;
actions use a per-turn lease and explicit approvals. This composition still
has reported usability failures. The [shell usability roadmap](shell-usability.md)
defines the required recovery and acceptance gates, including typed tool
transport and actual per-call completion states.
[Consumer capabilities](../../examples/shell/README.md)

Package versions and publish selection follow the proposed [Swelte release policy](versioning.md).

## Shell usability acceptance

The shell consumer is **not usability-accepted**. Repeated live failures include
raw tool syntax and a simple `pwd` question producing six running tool rows
instead of an answer. The [shell usability roadmap](shell-usability.md) defines
the open recovery milestones and acceptance evidence. Historical completion
checkboxes and individual successful probes below do not close those gates.

## Roadmap

Build the common structure once (designed for text + media + tools), ship the textual path first, keep media last. Work phases in order; do not start Phase D until the Phase B text slice replays cleanly from the recorder.

### A — Common structural skeleton (media-aware, no media dependency)

- [x] Freeze the AI envelope: `runId`, optional `turnId`, `outputId`, namespaced `kind`, `seq`.
- [x] Define terminal semantics: ending one output leaves other outputs active until the run emits a terminal event.
- [x] Define app-defined events: namespaced kind + versioned schema; a client skips an unfamiliar optional event.
- [x] Pin schema identity and versioning: one identity for tool args, structured outputs, app events, trace decoding; fail on unsupported V wire types.
- [x] Define capability advertisement split by input vs. output (modalities, encodings, duplex, structured output, tool calls, usage, cancellation).
- [x] Define the trace sink shape alongside the protocol: run / turn / track IDs, event order, schema versions, tool decisions, cancellation, usage, terminal outcome.
- [x] Lock the package boundary: `@swelte/media` optional peer, all media imports confined to `@swelte/ai/media`.

### B — Text path first (AI-only install, no `@swelte/media`)

- [x] Stream text over a streaming POST with SSE framing: text deltas, citations, tool progress, approval requests, structured patches.
- [x] Implement progressive draft state: typed patches at expected revision, gap to snapshot request, full validation before publish, one bounded repair.
- [x] Implement the provider adapters below and verify that one text consumer can switch among them. Route by declared capabilities, latency and budget.
  - [x] Deterministic adapter (offline, tests, fixtures).
  - [x] OpenRouter adapter (`@swelte/ai/openrouter`): OpenAI-compatible chat-completions over SSE, server-side key, model allowlist, usage + cancellation.
  - [x] Direct OpenAI adapter. Authenticate to OpenAI with the application's OpenAI credentials and map its responses to the shared run events.
  - [x] Direct Anthropic adapter. Authenticate to Anthropic with the application's Anthropic credentials and map its native streaming events to the same contract.
  - [x] Run one provider conformance suite through the public `AiAdapter` interface for all three network adapters. Cover text, usage when available, cancellation, provider errors and premature stream termination. Vary only adapter configuration and provider-specific HTTP fixtures.
- [x] Recording policy (metadata by default): prompts / transcripts / tool payloads opt-in independently, redaction, asset expiry. SQLite body still open.
- [x] Verify with packed packages in a clean app dir: AI alone (media absent), entry points import (`@swelte/ai`, `/openrouter`, `/openai`, `/anthropic`), capability routing picks by latency. Typecheck + build + run of a text route belongs to the shell/ai dogfood (Phase B last item).
- [x] Build the tool-free text fixture: live transcript + card, interrupt mid-reply, new turn; no stale output, validated card, trace explains.
- [x] `examples/shell` (`examples/shell`, `@swelte/ai` consumer, engine lib surface unchanged): chat + interactive shell sharing one backend shell at `/`. Chat transcript + auto-subscribed SSE terminal pane over one hub room; Enter runs the typed command via the authorized RPC shell path (`exec`, `chat`, `send_input` in server-only V) with providerLoop tool calls dispatched through the generated tools table (`tool_shell_exec` / `tool_shell_send_input` holder-lease gated, `tool_shell_read_output` read-only); per-call authorization (allowlist, AI needs human approval recorded on the dispatch-table record via `shell_tool_resume`/`shell_tool_deny`); one framed room protocol (`exec`/`chat`/`stdin` frames, one publish per event) with prompt and output on their own terminal lines, deduped against the optimistic paint — every command/output pair displays exactly once; while a command runs, Enter forwards keystrokes to its stdin (`cat` drains queued input; the tool path returns `{pending:true}` non-blocking); parked driving calls resume through one dispatch-table record (holder + expiry re-check, decide-then-dispatch, replay-safe) with expiry/duplicate/flip/lost-ack recovery (deny/expiry → actionable error, no partial side effect); interrupt marks turn interrupted and rejects late output. Verified: `swelte check` clean, 27/27 unit tests, native build, live run (RPC exec/chat/send_input/handoff/release/resume/deny + SSE tail), AI-only pack probe. SQLite headers are managed: `swelte build` lazily fetches the amalgamation via `vvm ensure-sqlite` only for backend-hub builds that need `db.sqlite` (cached under the managed toolchain, gitignored).

### C — Programmatic tools and approvals (still text-only)

- [x] Generate a tool manifest, JS bindings and native dispatch from explicit backend V declarations. Let the app select tools per run.
- [x] Run agent-authored JavaScript in a bounded backend QuickJS runtime. Validate and authorize each resolved call before dispatch.
  - [x] Step 1 (done): extract the shared `engine/qjs/` module — vendored QuickJS + `swelte_qjs.*` render glue moved verbatim out of `ssr-qjs/c/`; new `qjs.v` (`module qjs`: shared budgets, `QjsFailure` taxonomy, heap-buffer discipline) + `agent.v` (`agent_eval` stub failing actionably until the C entry lands). `ssr-qjs` consumes via `qjsCDir()` (single `@swelte/qjs` resolution). Proof: ssr-qjs suite 58/58 green, new V module passes `v test`.
  - [x] Step 2 (done): `swelte_agent.{c,h}` eval entry (fresh context, syntax check, timeout/mem/call-count/result caps, binding dispatch, job-queue pump, no I/O globals) + core's `hasRealBridge` generalized to `needsQjsLink` so SSR and PTC link one `.swelte/qjs/libqjs.a` exactly once. `buildQjsLib` split out of `buildQjsProd` for consumer-agnostic reuse (SSR bridge emission unchanged). Proof: C boundary probe (12 cases: pure eval, await, syntax/binding/timeout/memory/result-cap/call-count failures, malformed table, no I/O globals); V+C link check (`v test`); core link matrix (provider-only/SSR-only/agent-only/both/dangling).
  - [x] Step 3 (done): `@swelte/ai` `agentPlugin` (separate, opt-in: `includes()` stages `engine/qjs/`, `generate()` emits `agent/agent_bridge.v` + builds the archive via `@swelte/qjs`, actionable error without it). PTC end-to-end proven: staged module + emitted bridge + shared archive compile and run real JS in V (`agent_run_eval`: pure eval, top-level await, stub-rejected binding, timeout, result cap); SSR-only / PTC-only / both link once; provider-only emits nothing.
- [x] Exercise a read-only reporting tool: page authorized records, aggregate in V and return the top five with source IDs. Measure model round trips and bytes against one call per turn. (Done: shell `tool_top_commands{limit,page,caller}` → `[]TopRow{command,count,source_ids}`; caller-tagged ledger, deterministic rank, ≤5 rows/call; one dispatch/turn, ≤256B req / ≤1024B res; `examples/shell` offline + native `v test` proof.)
- [x] Enforce approval requirements at the backend dispatch boundary. Use the shell example to exercise approval, expiry, duplicates and lost acknowledgements (parked driving turn: `record → human decision via shell_tool_resume/shell_tool_deny → dispatch`, holder + expiry re-check, replay-safe; denied/lapsed → actionable error, never a hang). Defer a common browser approval protocol until another application needs it.

Shared-`qjs` ownership: `@swelte/qjs` is joint SSR+PTC infrastructure (one vendored engine, two C contracts, one V module staged once into `.swelte/qjs/`). Neither consumer vendors a copy; both resolve the one `@swelte/qjs` package (leaf-first, versioned on the shared line). `qjsCDir()` and `agentQjsModuleDir()` each carry one candidate: `createRequire(fromUrl).resolve('@swelte/qjs/package.json')`.

### D — Media last (`@swelte/ai/media` + `@swelte/media` composition)

- [ ] Media integration behind `@swelte/ai/media`: track ID or asset ref per event; app authorizes reads and subscriptions.
- [ ] Interruption: stop local player immediately, mark turn interrupted, request upstream cancel, reject late output; measure local vs upstream separately.
- [ ] Verify in a second clean app: AI + min media version; capability check fails actionably before capture on a video-less adapter.
- [ ] Fixture with prerecorded camera + sensor track: slow consumer, missing patch; bounded buffering, sync timestamps, snapshot recovery, control events.
- [ ] Voice-and-photo loop: live transcript + annotated image + card while playing reply; interrupt mid-sentence; silence, stale rejection, validated card, metadata-only trace.


## Package boundary and typed multiplexing

A text-only app can use `@swelte/ai` directly. A voice or camera app composes it with the optional [`@swelte/media` package](media.md). Each package can use Swelte's general HTTP and WebSocket primitives independently. The application connects media tracks to AI turns after checking the provider's input and output capabilities.

Declare the tested media range in AI's `peerDependencies` and set `peerDependenciesMeta["@swelte/media"].optional` to `true`. npm then leaves media out of an AI-only install. Put the integration behind the proposed `@swelte/ai/media` entry point. Keep media imports, including public TypeScript declaration references and native V module imports, confined to the integration. [npm optional peer dependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#peerdependenciesmeta)

Verify with packed packages in clean app directories outside the monorepo. Install AI alone, confirm media is absent, then typecheck, build and run a text-streaming route. In a second app, install both packages and exercise the media entry point with the minimum supported media version.

The AI envelope associates events with a run, a turn where applicable, an output ID, an event kind and a sequence number. Text deltas, transcript revisions, citations, tool progress, approval requests and structured patches can share a streaming POST response with SSE framing. Give app-defined events a namespaced kind and a versioned schema. A client can skip an unfamiliar optional event and continue consuming the run. Ending one output leaves the other outputs active until the run emits a terminal event.

For media, an event identifies a track or an authorized asset reference. The media package supplies format, presentation timestamps and playback state. A photo or document can also be supplied as an authorized attachment in a run that needs no capture or playback. The app authorizes asset reads and subscriptions. The AI adapter maps supported content into the provider's format.

When a user interrupts a spoken reply, the application stops the media player immediately. The AI session marks the turn interrupted, requests upstream cancellation and rejects late output for that turn. A provider acknowledgement can arrive after the next turn starts. Measure local playback stop and upstream cancellation separately, including while the provider is idle. [Native stream lifecycle](../streaming.md)

## Schema management and progressive state

Generate versioned JSON Schema and TypeScript representations from the supported V wire types. Use the same schema identity for tool arguments, final structured outputs, app-defined events and trace decoding. Fail generation on unsupported field types. Preserve required, optional and nullable semantics and pin the schema version for the lifetime of a run. [V type projection](../types.md)

Keep progressive UI state as a draft. Apply typed patches against an expected revision, detect gaps and request a snapshot before applying further patches. Only publish a completed V/TS value after full validation. A bounded repair attempt may replace an invalid provider response. It must never repeat an already executed tool. Test an interrupted draft, an old schema version and a provider that supports only a subset of the declared schema.

## Provider abstraction and routing

The proposed V provider interface follows the TypeScript adapter model. Each adapter advertises capabilities separately for input and output, including modalities, supported encodings, duplex streaming, structured output, tool calls, usage reporting and cancellation. Select an adapter against the run's requirements before opening devices or sending data. For example, an adapter accepting image uploads may still lack live video input. Make any downsampling, transcription or frame extraction an explicit app choice.

Start with a deterministic adapter and two real adapters with different capabilities before stabilizing the interface. Let applications choose routing by capability, latency and budget. Record the chosen provider and model. Permit automatic fallback before visible output or side effects. A new attempt after that point needs an explicit transition the UI and recorder can identify.

## Observability, logging, replay and evaluation

Define a trace sink alongside the protocol. Record run, turn and track IDs, event order, schema versions, tool decisions, cancellation, provider usage when available and terminal outcome. Measure time to first transcript, image or audible output, queue depth, dropped frames and upstream stop latency. Keep estimated cost distinguishable from provider-reported usage.

Offer an optional SQLite recorder with retention controls. Default to metadata. Make prompts, transcripts, tool payloads and media opt-in independently, with redaction before persistence and explicit expiry for referenced assets. Replay a recorded sequence through the Svelte reducer using recorded tool outcomes. An eval can check caption timing, final schema validity or tool choice offline. Metadata-only traces support timing and lifecycle checks without reconstructing content.

## Programmatic tools and approvals

Phase C uses `@[tool]` on application functions in `src/lib/backend/`. The attribute is independent of `@[rpc]` and HTTP routes. Shared V code can be called by a backend tool. All agent tool calls execute on the backend in this phase. Browser TS tools, browser WASM dispatch and a backend-to-browser tool bridge are deferred. The browser talks to the application backend, which owns the provider session and credentials. The IDE's project MCP server is a separate surface. [Project MCP](../mcp.md)

Explicit registration replaced the automatic discovery prototype (see `../plus.md`). The app registers the tools plugin in its Vite config — installing `@swelte/ai` alone no longer enables codegen:

```ts
import { toolsPlugin } from '@swelte/ai/tools'
import { swelte } from '@swelte/core/vite'

export default defineConfig({
	plugins: [svelte(), swelte({ plugins: [toolsPlugin] })],
})
```

The plugin claims `tool`, validates backend placement + tool shape per file, and writes `tool_manifest.json`, `tools.gen.mjs` and `tools.gen.v` under `.swelte/tools/` on every run — so removing the plugin or the last declaration prunes the module. An app using only provider adapters (no plugin) emits no tools module. For each run, the app selects a subset of the manifest and supplies the authenticated caller. The adapter translates the selected definitions into the provider's format for ordinary named calls. `swelte_tool_dispatch` takes `(allowed, name, args_json, caller, op_id)`: read-only tools ignore caller/op_id; side-effect tools additionally require a recorded approval (see below). Register via the node-only `@swelte/ai/tools` subpath (`toolsPlugin`, `agentPlugin` + build-time helpers); the browser-safe `@swelte/ai` index carries only runtime values and types — `./build.js` internals are module-private and never exported from the package index.

For programmatic calls, the provider-facing tool accepts a JavaScript source string, and the model receives signatures for the selected bindings. TypeScript declarations describe those bindings. The backend evaluates the program as async JavaScript in a dedicated QuickJS context (`engine/qjs`: `swelte_agent_eval` — fresh context per call, syntax + static-reference check first, timeout, memory, call-count and result-size caps, job-queue pumped until settle, no I/O globals). Each binding calls the native host dispatcher. The host resolves or rejects the binding's promise and advances the QuickJS job queue. The completion value serializes to JSON (`undefined` → `null`); oversize results reject, never truncate. Immediately before each native call, validate its resolved arguments, remaining budget and caller authorization. Validate the result before returning it to the program. Until the V host dispatcher entry lands, declared bindings reject actionably naming the binding + resolved args (native side effects never run) — named calls are unaffected and stay QJS-free.

Programmatic evaluation is opt-in via a separate `agentPlugin` (`swelte({ plugins: [toolsPlugin, agentPlugin] })`): it stages the shared `module qjs` into `.swelte/qjs/`, emits `agent/agent_bridge.v` (`agent_run_eval` over the shared engine) and links the one `.swelte/qjs/libqjs.a` — mtime-guarded, shared with the SSR adapter. Without `@swelte/qjs` installed the archive step fails actionably naming the install. The browser-safe `@swelte/ai` index never re-exports plugin/build entry points (they would pull the server-only `@swelte/core/vite` barrel into client bundles); node consumers import `@swelte/ai/tools` directly.

Tools are application-defined. Shell execution and stdin handling belong to the shell example. Phase C defines no default tool catalog, including web fetch. An application may publish SSE progress or UI events when useful. Tool declarations and calls have no required event transport.

For human approval, keep the execution decision on the backend. A call requiring approval stays unexecuted until the application records a valid decision bound to the authenticated caller, tool, exact arguments and operation ID. Denial or expiry prevents execution. Duplicate decisions and lost acknowledgements must be recoverable without repeating a side effect. If the application provides no approval flow, reject calls requiring one. The shell example can use its own UI and events. Defer standardizing how a frontend receives pending requests, submits decisions and resynchronizes after reconnecting.

Enforced at the dispatch boundary (not by convention): the generated `tools` module owns an approval table (`swelte_tool_approval_record/decide/lookup/complete`, `__global`-backed). The route (trusted backend) records op ids and decisions; the dispatcher validates caller + tool + exact args before running a side-effect fn, fails closed on unknown/mismatched/denied/pending/expired op ids, and replays the stored result for executed op ids instead of re-running. Read-only tools never touch the table. The shell example exercises the full matrix through `GET /api/tools?only=note` (unapproved → `unknown approval`; `&approve=1` → records + approves + dispatches; repeated `&op=` → replay).

The shell example drives its own terminal through that loop today: observe turns dispatch read-only tools with caller `ai-observe`; driving turns hand the `shell:driver` lease to the turn holder, park `shell.exec` / `shell.send_input` as one dispatch-table record (`approval.request`), and resume on the human decision via `shell_tool_resume` (records `approved`, re-checks holder + expiry, dispatches once) or `shell_tool_deny` (records `denied`, fails a late resume closed). Human input or Stop preempts the lease; scoped stdin pre-approval and transcript-tail re-entry complete the loop. The shell README is the user entry point; the [Agentic shell](agentic-shell.md) spec tracks the fixtures.

## First end-to-end fixture

Build a tool-free inspection session. A user describes a photo by voice. The page displays a live transcript, an annotated image and a progressively filled inspection card while playing the spoken reply. Interrupt the reply mid-sentence and start another turn. Verify that old audio never resumes, the new transcript stays associated with its turn, the final card validates, and the trace explains the interruption without retaining the photo or audio by default.

Extend the same fixture with a prerecorded camera stream and a custom timed sensor track. Slow the consumer and inject a missing patch. Verify bounded buffering, synchronized timestamps, snapshot recovery and continued delivery of control events. Run the capability check against an adapter without video support and assert an actionable failure before capture begins. Exercise the reporting tool loop independently to measure its contribution.
