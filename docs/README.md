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
- `streaming.md` — native POST byte streams, framing, cancellation and buffering
- `cli.md` — `dev`/`build`/`preview`/`test`/`check`/`init`/`export`, `--target`, contract snapshot (implemented)
- `ssr.md` — SSR, built (ownership, request path, `@[load]` cascade, `+error` contract, measured budgets, gate)
- `mcp.md` — Agents: MCP server + skills install (implemented)
- `plus.md` — `@swelte/plus`: beyond-SvelteKit plugins, `jobs` (`@[cron]` ticks: wiring, retry, console log)
- `example.md` — the `something` example (implemented; browseable twin: `examples/docs-site/`)
- `versus.md` — Swelte vs. other full-stack paradigms (positioning)
- `coming-from-sveltekit.md` — SvelteKit → Swelte migration map (built behavior)


## Internal

Internal docs to modify Swelte (design rationale, decisions, ephemeral notes):

- `internal/v-imports.md` — `.v` imports design reference (§1–§5 built) + decisions log (§6)
- `internal/load.md` — `@[load]` page-data cascade design note (ephemeral; contract lives in `../rpc.md`)

## Specs

Forward plans and migration validation (demo coverage does not imply production
migration parity):

- `specs/dogfood-roadmap.md` — active EMV/micro execution tracker: ownership, verified baseline, delivery gates and progress
- `specs/page-lifecycle-contract.md` — load/state/hydration and action contract; implementation and remaining acceptance tracked in the roadmap
- `specs/micro.md` — micro-specific inventory; shared progress lives in the dogfooding roadmap
- `specs/future.md` — Beyond SvelteKit (jobs done in `@swelte/plus`; channels/SWR/images/outbox/hardening/agent-native next)
