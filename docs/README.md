# Docs

User documentation lives here at the top level — built behavior for Swelte users.
Contributor notes live in `internal/`. Forward plans live in `specs/`.

## User docs (root)

Documentation for users of Swelte (all describe built behavior):

- `rpc.md` — `.v` imports, attributes, transport (implemented)
- `types.md` — V → TS projection, codegen (implemented)
- `errors.md` — error envelope, `SwelteRpcError`, SPA-first rule (implemented)
- `config.md` — `svelte.config.js` (`swelte` key) + `SWELTE_*` env knobs, routing knobs, per-route types, no-JS (implemented)
- `forms.md` — verbs + `?q`, no-JS 303, `fail`-lite (`isFail`), `deserialize`, `use:enhance` / `applyAction` (implemented)
- `cli.md` — `dev`/`build`/`preview`/`test`/`check`/`init`/`export`, `--target`, contract snapshot (implemented)
- `ssr.md` — SSR, built (ownership, request path, `@[load]` cascade, `+error` contract, measured budgets, gate)
- `mcp.md` — `@swelte/mcp` stdio server: tools, client config, wasm maps (implemented)
- `example.md` — the `something` example (implemented; browseable twin: `examples/docs-site/`)
- `versus.md` — Swelte vs. other full-stack paradigms (positioning)
- `coming-from-sveltekit.md` — SvelteKit → Swelte migration map (built behavior)


## Internal

Internal docs to modify Swelte (design rationale, decisions, ephemeral notes):

- `internal/v-imports.md` — `.v` imports design reference (§1–§5 built) + decisions log (§6)
- `internal/load.md` — `@[load]` page-data cascade design note (ephemeral; contract lives in `../rpc.md`)

## Specs

Open tracking notes for the remaining polish:

- `specs/docs.md` — doc review note (`svg icon`)
- `specs/more.md` — open questions (code splitting)
