# Docs

User documentation lives here at the top level — built behavior for Swelte users.
Contributor notes live in `internal/`. Forward plans live in `specs/`.

## User docs (root)

Documentation for users of Swelte (all describe built behavior):

- `rpc.md` — `.v` imports, attributes, transport (implemented)
- `libraries.md` — library schema: `src/lib` (published) + `src/routes` (dogfood), `build` vs `build:lib`, `swelte check --lib`
- `npm-v-libraries.md` — publish and consume reusable V modules through npm (consumer-side reference; library-side schema lives in `libraries.md`)
- `types.md` — V → TS projection, codegen (implemented)
- `errors.md` — error envelope, `SwelteRpcError`, SPA-first rule (implemented)
- `config.md` — `svelte.config.js` (`swelte` key) + `SWELTE_*` env knobs, routing knobs, per-route types, no-JS (implemented)
- `forms.md` — verbs + `?q`, no-JS 303, `fail`-lite (`isFail`), `deserialize`, `use:enhance` / `applyAction` (implemented)
- `images.md` — native build-time resize/WebP assets and generated image metadata
- `outbox.md` — explicit IndexedDB mutation queue, Background Sync, retries and failures
- `streaming.md` — native POST byte streams, framing, cancellation and buffering
- `lifecycle.md` — startup ordering, cooperative shutdown, resource drain and native reporting
- `native-runtime-measurements.md` — repeatable native fixture workload and recorded measurement scope
- `cli.md` — `dev`/`build`/`preview`/`test`/`check`/`export` (+ deprecated `init` forwarder), `--target`, contract snapshot (implemented)
- `ssr.md` — SSR, built (ownership, request path, `@[load]` cascade, `+error` contract, measured budgets, gate)
- `mcp.md` — Agents: MCP server + skills install (implemented)
- `plus.md` — `@swelte/plus`: beyond-SvelteKit plugins, `jobs` (`@[cron]` ticks: wiring, retry, durable schedules and coordination)
- `example.md` — the `something` example (implemented; browseable twin: `examples/docs-site/`)
- `versus.md` — Swelte vs. other full-stack paradigms (positioning)
- `coming-from-sveltekit.md` — SvelteKit → Swelte migration map (built behavior)


## Internal

Internal docs to modify Swelte (design rationale, decisions, ephemeral notes):

- `internal/v-imports.md` — `.v` imports design reference (§1–§5 built) + decisions log (§6)
- `internal/load.md` — `@[load]` page-data cascade design note (ephemeral; contract lives in `../rpc.md`)

## Specs

- `specs/future.md` — delivery status for the framework follow-ups
- `specs/dogfood-roadmap.md` — concise report of completed dogfood work and its regression coverage

The delivered load/state/hydration and action contract is documented in
[page-lifecycle.md](page-lifecycle.md).
