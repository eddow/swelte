# Provider abstraction and multimodal AI sessions

`@swelte/ai` is intended to do for model providers what an ORM does for databases. An application describes a run once and consumes a common event stream. A provider adapter translates that request into the provider’s API and translates its responses back into Swelte events. Just as an ORM can target PostgreSQL or MySQL, the intended adapter family includes OpenRouter, direct OpenAI, direct Anthropic and other providers. Applications choose a provider and model at configuration time. Each adapter advertises its capabilities so a run can require features such as tool calls or structured output.

**Implemented in `engine/ai` today:** the TypeScript `AiAdapter.run(input, requirements)` contract accepts a text string and returns an asynchronous stream of `WireEvent` values. `routeAdapter` selects among supplied candidates using capabilities and configured latency and cost estimates. The deterministic adapter supports offline tests. OpenRouter is the first network adapter and translates streamed text, token usage and completion into Swelte events. Its tests use an injected HTTP transport. [Adapter contract and routing](../../engine/ai/src/lib/adapters.ts) · [OpenRouter implementation](../../engine/ai/src/lib/openrouter.ts) · [Adapter tests](../../engine/ai/src/lib/openrouter.test.ts)

**Portability still to prove:** direct OpenAI and Anthropic adapters are future targets. Selecting a model through OpenRouter exercises the OpenRouter API. The proposed native V provider interface, multi-turn and multimodal requests, and provider-independent cancellation still need implementation. For example, the OpenRouter adapter accepts an abort signal today through an adapter-specific third argument. The acceptance test for a second provider is to run the same text consumer against two distinct provider protocols by changing only the adapter configuration, and verify text deltas, usage when available, cancellation and terminal outcomes.

Package versions and publish selection follow the proposed [Swelte release policy](versioning.md).

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
- [x] Dogfood `shell/ai` (route `src/routes/shell/ai`, dogfood-only, `engine/ai` lib surface unchanged): chat + interactive shell sharing one backend shell. Conversation transcript + terminal pane over SSE/WS on one hub room; human and AI both send commands and keystrokes via authorized PTC shell tools (`exec`, `send_input`, `chat`, `approve`, `deny` declared in server-only V, run in TS/V); per-call authorization (allowlist, AI needs human approval); approvals persisted by caller + exact args + op id with expiry/duplicate/lost-ack recovery; interrupt marks turn interrupted and rejects late output. Verified: checks, unit tests (core 313/313, ai 31/31), native build, live run (RPC exec/chat/approve/SSE tail/WS keystroke), AI-only pack probe. SQLite headers are managed: `swelte build` lazily fetches the amalgamation via `vvm ensure-sqlite` only for backend-hub builds that need `db.sqlite` (cached under the managed toolchain, gitignored).

### C — Programmatic tools and approvals (still text-only)

- [ ] Server-only V tool declarations generating callable bindings + input/output schemas; app selects tools per run.
  - [ ] Shared shell tools (`shell.exec`, `shell.sendInput`, web fetch) first: bounded commands, PTY keystroke injection, per-call authorization.
- [ ] Pre-execution validation (names, types, references, budgets); measure round trips and bytes vs one-call-per-turn baseline.
- [ ] Bounded reporting plan: page authorized records, aggregate in V, return top five with source IDs.
- [ ] Persist side-effect approvals against caller + exact args + operation ID; exercise expiry, duplicate, lost-ack recovery.
- [ ] Dogfood proves it: human approves AI shell commands in-chat (approval gate), duplicate/expiry/lost-ack via the shared shell.

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

Explore server-only V tool declarations that generate callable bindings and input/output schemas. An app selects tools for each run and supplies the authenticated caller. The IDE's project MCP server remains a separate surface. [Project MCP](../mcp.md)

A bounded plan can page through authorized records, aggregate in V and return the top five with source IDs. Validate tool names, types, references and declared budgets before execution, then authorize each resolved call. Measure model round trips and result bytes against a one-call-per-turn baseline. For side effects, persist approval against the caller, exact arguments and operation ID. Exercise expiry, duplicate approval and recovery after an external action succeeds but its acknowledgement is lost.

## First end-to-end fixture

Build a tool-free inspection session. A user describes a photo by voice. The page displays a live transcript, an annotated image and a progressively filled inspection card while playing the spoken reply. Interrupt the reply mid-sentence and start another turn. Verify that old audio never resumes, the new transcript stays associated with its turn, the final card validates, and the trace explains the interruption without retaining the photo or audio by default.

Extend the same fixture with a prerecorded camera stream and a custom timed sensor track. Slow the consumer and inject a missing patch. Verify bounded buffering, synchronized timestamps, snapshot recovery and continued delivery of control events. Run the capability check against an adapter without video support and assert an actionable failure before capture begins. Exercise the reporting tool loop independently to measure its contribution.
