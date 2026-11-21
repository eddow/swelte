# `@swelte/ai`

A provider adapter translates a Swelte run into a model provider request and returns a shared stream of events. The TypeScript text implementation includes capability-based routing, an offline deterministic adapter and an OpenRouter adapter. Direct OpenAI and direct Anthropic adapters are planned. The [provider roadmap](../../docs/specs/ai.md) tracks each separately.

A text-only app uses `@swelte/ai` alone. A voice or camera app composes it
with the optional [`@swelte/media` package](../../docs/specs/media.md) behind
the `@swelte/ai/media` entry point.
