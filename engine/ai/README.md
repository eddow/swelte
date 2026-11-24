# `@swelte/ai`

A provider adapter translates a Swelte run into a model provider request and returns a shared stream of events. The TypeScript text implementation includes capability-based routing, an offline deterministic adapter and an OpenRouter adapter. Direct OpenAI and direct Anthropic text adapters are implemented and fixture-tested; this does not imply live-provider certification. The [provider roadmap](../../openspec/plans/ai.md) tracks each separately.

A text-only app uses `@swelte/ai` alone. A voice or camera app composes it
with the optional [`@swelte/media` package](../../openspec/plans/media.md) behind
the `@swelte/ai/media` entry point.

This is a standard Swelte project: `npm run build` builds its local application
from `src/routes` into `dist/`; `npm run package` builds the reusable `src/lib`
API into `package/`. Published exports refer to `package/`, and demo routes
are excluded from the npm archive.
