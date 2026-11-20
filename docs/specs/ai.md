# Proposal for multimodal AI sessions

An opt-in `@swelte/ai` package would let a Svelte page and a V backend exchange typed content throughout a run. A run may produce several outputs at once, accept new input while it is active, and finish without calling any tools. Keep the protocol, adapters and recording policy in the package. Reuse Swelte's native transport and V type declarations where they fit.

## Package boundary and typed multiplexing

A text-only app can use `@swelte/ai` directly. A voice or camera app composes it with the optional [`@swelte/media` package](media.md). Each package can use Swelte's general HTTP and WebSocket primitives independently. The application connects media tracks to AI turns after checking the provider's input and output capabilities.

The AI envelope associates events with a run, a turn where applicable, an output ID, an event kind and a sequence number. Text deltas, transcript revisions, citations, tool progress, approval requests and structured patches can share a streaming POST response with SSE framing. Give app-defined events a namespaced kind and a versioned schema. A client can skip an unfamiliar optional event and continue consuming the run. Ending one output leaves the other outputs active until the run emits a terminal event.

For media, an event identifies a track or an authorized asset reference. The media package supplies format, presentation timestamps and playback state. A photo or document can also be supplied as an authorized attachment in a run that needs no capture or playback. The app authorizes asset reads and subscriptions. The AI adapter maps supported content into the provider's format.

When a user interrupts a spoken reply, the application stops the media player immediately. The AI session marks the turn interrupted, requests upstream cancellation and rejects late output for that turn. A provider acknowledgement can arrive after the next turn starts. Measure local playback stop and upstream cancellation separately, including while the provider is idle. [Native stream lifecycle](../streaming.md)

## Schema management and progressive state

Generate versioned JSON Schema and TypeScript representations from the supported V wire types. Use the same schema identity for tool arguments, final structured outputs, app-defined events and trace decoding. Fail generation on unsupported field types. Preserve required, optional and nullable semantics and pin the schema version for the lifetime of a run. [V type projection](../types.md)

Keep progressive UI state as a draft. Apply typed patches against an expected revision, detect gaps and request a snapshot before applying further patches. Only publish a completed V/TS value after full validation. A bounded repair attempt may replace an invalid provider response. It must never repeat an already executed tool. Test an interrupted draft, an old schema version and a provider that supports only a subset of the declared schema.

## Provider abstraction and routing

Each V adapter advertises capabilities separately for input and output, including modalities, supported encodings, duplex streaming, structured output, tool calls, usage reporting and cancellation. Select an adapter against the run's requirements before opening devices or sending data. For example, an adapter accepting image uploads may still lack live video input. Make any downsampling, transcription or frame extraction an explicit app choice.

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
