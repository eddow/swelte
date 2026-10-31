# Docs

User documentation lives here at the top level — built behavior for Swelte users.
Contributor notes live in `internal/`. Forward plans live in `specs/`.

## User docs (root)

Documentation for users of Swelte (all describe built behavior):

- `rpc.md` — `.v` imports, attributes, transport (implemented)
- `types.md` — V → TS projection, codegen (implemented)
- `errors.md` — error envelope, `SwelteRpcError`, SPA-first rule (implemented)
- `ssr.md` — SSR, built (ownership, request path, `@[load]` cascade, `+error` contract, measured budgets, gate)
- `example.md` — the `something` example (implemented)
- `versus.md` — Swelte vs. other full-stack paradigms (positioning)

## Internal

Internal docs to modify Swelte (design rationale, decisions, ephemeral notes):

- `internal/v-imports.md` — `.v` imports design reference (§1–§5 built) + decisions log (§6)
- `internal/load.md` — `@[load]` page-data cascade design note (ephemeral; contract lives in `../rpc.md`)

## Specs

Specifications of what has to be done (plans, open work only):

- `specs/roadmap.md` — forward work only (open items)
- `specs/ssr.md` — SSR open work (bytecode opt, `ssr-bun`, CI)
- `specs/4agents.md` — agent tooling proposal (MCP server, skill packs)
