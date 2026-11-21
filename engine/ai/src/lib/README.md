# `@swelte/ai` — `src/lib` concept map

Browser-safe library surface (no `node:*` imports — see `version.ts`). The package
boundary is `src/lib/index.ts`; `src/routes/` is dogfood and never published.
`@swelte/media` is an optional peer — only `media.ts` / `boundary.ts` may touch
media shapes, and only as structural contracts.

| module | owns | key exports |
|---|---|---|
| `envelope.ts` | run skeleton: envelope, kinds, terminal lifecycle | `AiEnvelope`, `AI_BUILTIN_KINDS`, `isBuiltinKind/isAppKind/isKnownKind`, `validateEnvelope`, `RunTerminalReason`, `RunTracker` |
| `capabilities.ts` | capability advertisement + selection | `Modality`, `DirectionCaps`, `AdapterCaps`, `RunRequirements`, `AdapterSelection`, `selectAdapter`, `capabilityFailure` |
| `adapters.ts` | `AiAdapter` contract + latency/budget routing + offline adapter | `AiAdapter`, `CostModel`, `RouteOptions`, `routeAdapter`, `DeterministicAdapter` |
| `openrouter.ts` | 1st network adapter (chat-completions SSE) | `OpenRouterAdapter`, `OPENROUTER_CAPS`, `checkOpenRouterFit`, `openRouterFromEnv` |
| `openai.ts` | 2nd network adapter (Responses SSE, native stored usage) | `OpenAiAdapter`, `OPENAI_CAPS`, `checkOpenAiFit`, `openAiFromEnv` |
| `anthropic.ts` | 3rd network adapter (Messages SSE) | `AnthropicAdapter`, `ANTHROPIC_CAPS`, `checkAnthropicFit`, `anthropicFromEnv` |
| `sse.ts` | wire framing: one envelope + payload per SSE message | `WireEvent`, `encodeSseEvent`, `decodeSseEvent`, `createSseParser` |
| `draft.ts` | progressive UI state: revisioned patches, snapshot, 1 bounded repair | `DraftStore`, `TypedPatch`, `PatchOp`, `DraftSnapshot` |
| `trace.ts` | observability: sink, usage vs. estimate kept distinct | `TraceEvent`, `TraceSink`, `createMemorySink`, `estimateCost`, `ProviderUsage`, `CostEstimate`, `PriceTable` |
| `recorder.ts` | retention policy: metadata by default, opt-in slices | `RecorderPolicy`, `METADATA_ONLY`, `StoredRecord`, `applyPolicy`, `redactForPolicy` |
| `schema.ts` | versioned shape identity for tools / outputs / app events / trace | `SchemaIdentity`, `schemaId`, `WireStruct`, `GeneratedSchema`, `generateSchema` |
| `boundary.ts` | media type contracts only — never imports `@swelte/media` | `MediaTrackRef`, `MediaAssetRef`, `MediaEventPayload`, `isTrackPayload` |
| `media.ts` | Phase-D placeholder entry point (`@swelte/ai/media`) | `assertMediaReady` (throws until implemented) |
| `version.ts` | browser-safe version constant | `VERSION` |
| `index.ts` | public re-export surface | everything above (minus dogfood) |

## Static structure

```mermaid
classDiagram
    class AiEnvelope {
        +string runId
        +string turnId?
        +string outputId
        +string kind
        +int seq
    }
    class RunTracker {
        -ended Set
        -terminal RunTerminal
        +endOutput(outputId)
        +finish(reason, atSeq)
        +isTerminal bool
    }
    class RunTerminalReason {
        <<union>>
        completed
        cancelled
        failed
        interrupted
    }
    AiEnvelope --> RunTerminalReason : terminal payload
    RunTracker --> RunTerminalReason
    class Modality {
        <<union>>
        text | image | audio | video | structured | sensor
    }
    class DirectionCaps {
        +Modality[] modalities
        +string[] encodings
        +bool duplex
        +bool stream?
    }
    class AdapterCaps {
        +DirectionCaps input
        +DirectionCaps output
        +bool structuredOutput
        +bool toolCalls
        +bool usageReporting
        +bool cancellation
    }
    class RunRequirements {
        +Modality[] input
        +Modality[] output
        +bool structuredOutput?
        +bool toolCalls?
        +bool usageReporting?
        +bool cancellation?
        +string[] encodings?
    }
    class AdapterSelection {
        +string name
        +string model
        +AdapterCaps caps
    }
    DirectionCaps --> Modality
    AdapterCaps *-- DirectionCaps
    AdapterSelection *-- AdapterCaps
    RunRequirements --> Modality
    class AiAdapter {
        +string name
        +string model
        +AdapterCaps caps
        +float latencyMs
        +PriceTable pricing?
        +float maxCostPer1k?
        +run(input, requirements) AsyncIterable~WireEvent~
    }
    class RouteOptions {
        +float maxLatencyMs?
        +float maxCostPer1k?
    }
    class DeterministicAdapter {
        +run() echo text.delta + terminal
    }
    class OpenRouterAdapter {
        +OPENROUTER_CAPS
        +checkOpenRouterFit()
        +openRouterFromEnv()
    }
    class OpenAiAdapter {
        +OPENAI_CAPS
        +checkOpenAiFit()
        +openAiFromEnv()
    }
    class AnthropicAdapter {
        +ANTHROPIC_CAPS
        +checkAnthropicFit()
        +anthropicFromEnv()
    }
    AiAdapter --|> AdapterSelection
    DeterministicAdapter ..|> AiAdapter
    OpenRouterAdapter ..|> AiAdapter
    OpenAiAdapter ..|> AiAdapter
    AnthropicAdapter ..|> AiAdapter
    class WireEvent {
        +AiEnvelope envelope
        +unknown payload
    }
    WireEvent *-- AiEnvelope
    AiAdapter ..> WireEvent : yields
    class SSE {
        <<module sse.ts>>
        +encodeSseEvent()
        +decodeSseEvent()
        +createSseParser()
    }
    SSE ..> WireEvent : frames
    class DraftStore~T~ {
        -revision int
        -value T
        +applyPatch() bool
        +applySnapshot()
        +repair() once
    }
    class TypedPatch {
        +int expectedRevision
        +PatchOp[] ops
    }
    DraftStore ..> TypedPatch : applies
    class TraceEvent {
        +string runId / turnId? / trackId?
        +string outputId
        +int seq
        +string kind
        +SchemaIdentity schema?
        +tool decision?
        +cancellation?
        +ProviderUsage usage?
        +CostEstimate estimatedCost?
        +PriceTable pricing?
        +RunTerminalReason terminal?
    }
    class TraceSink {
        <<interface>>
        +record(event)
    }
    TraceEvent --> ProviderUsage
    TraceEvent --> RunTerminalReason
    class RecorderPolicy {
        +bool prompts
        +bool transcripts
        +bool toolPayloads
        +bool media
    }
    class PriceTable {
        +string currency
        +float inputPer1k
        +float outputPer1k
        +string source?
    }
    class CostEstimate {
        +string currency
        +float amount
        +string basis
    }
    class StoredRecord {
        +int expiresAt?
    }
    RecorderPolicy ..> StoredRecord : applyPolicy filters
    class SchemaIdentity {
        +string name
        +string version
    }
    class GeneratedSchema {
        +SchemaIdentity identity
        +jsonSchema
        +typeScript
    }
    class WireStruct {
        +string name
        +Record~string, WireFieldType~ fields
    }
    GeneratedSchema *-- SchemaIdentity
    class MediaEventPayload {
        <<union>>
        track | asset
    }
    RunRequirements ..> AdapterSelection : selectAdapter picks first cover
    RouteOptions ..> AiAdapter : routeAdapter filters latency + maxCostPer1k
    PriceTable ..> TraceEvent : estimateCost usage x table
```

## Runtime flow (one text run)

```mermaid
flowchart TD
    REQ["RunRequirements<br/>input/output modalities + flags"] --> SEL{"selectAdapter<br/>input AND output cover?"}
    SEL -- "no" --> FAIL["capabilityFailure<br/>human-actionable string"]
    SEL -- "yes" --> ROUTE["routeAdapter<br/>filter maxLatency/maxCostPer1k<br/>adapters without a table never pass a budget<br/>sort by latency, stable by name"]
    ROUTE --> FIT{"checkXFit<br/>allowlist + text-only gate<br/>per adapter?"}
    FIT -- "unfit" --> ERR["throw before any network"]
    FIT -- "fit" --> RUN["adapter.run input, requirements, opts?<br/>Deterministic / OpenRouter / OpenAI / Anthropic"]
    RUN --> SSE["WireEvent stream<br/>envelope runId/outputId/kind/seq + payload"]
    SSE --> ENC["encodeSseEvent / decodeSseEvent / createSseParser<br/>one SSE message per event"]
    SSE --> TRACE["TraceSink.record<br/>text.delta + terminal carry usage"]
    TRACE --> USAGE{"usage vs estimate"}
    USAGE -- "provider-reported" --> PROV["ProviderUsage.cost<br/>basis=provider-reported"]
    USAGE -- "local math" --> EST["estimateCost usage x PriceTable<br/>basis=table-estimate, absent when unknown"]
    SSE --> DRAFT["DraftStore.applyPatch<br/>expectedRevision or snapshot request"]
    DRAFT -- "gap" --> SNAP["state.snapshot.request"]
    DRAFT -- "invalid value" --> REP["repair once<br/>never repeats executed tool"]
    SSE --> REC["applyPolicy record, policy<br/>METADATA_ONLY default"]
    SSE --> TERM["terminal event<br/>completed / failed / cancelled / interrupted"]
    TERM --> TRACK["RunTracker.finish<br/>endOutput leaves siblings active"]
```

## Layering rules (read the diagram this way)

- `envelope` + `capabilities` are the base — everything points at them, they
  point at nothing.
- `adapters` + the three network adapters depend on `capabilities` (fit gate),
  `envelope` (terminal reason) and `sse`/`trace` (event + usage types).
- `sse` frames what adapters yield; `trace` observes it; `draft` / `recorder` /
  `schema` consume it. None of them import each other (except `trace` -> `schema`
  for the `SchemaIdentity` field type).
- `boundary` is type-only; `media` re-exports it and throws until Phase D.
- `index.ts` re-exports the public surface only — consumer demos (e.g. the
  `examples/shell` approval helper in its own `src/lib/`) are never imported
  from `#lib`.
