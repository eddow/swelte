---
name: swelte-mcp
description: Query a Swelte project via the @swelte/mcp server — route tree, type contracts, diagnostics, scaffolding. Use when inspecting routes, validating data contracts, or debugging build/SSR/wasm errors.
---

# Swelte MCP

The `@swelte/mcp` server (stdio only) exposes the project to agents.
Spawn it per the client's `mcpServers` config (`docs/mcp.md`); the
tools below are what it offers.

## Tools

- `list_routes` — route tree: `.v` file → URL path, RPC fns, `.svelte` partner.
- `get_route { route }` — one route: V fns with params/returns, structs, source.
- `check` — `swelte check` diagnostics (orphans, clashes, unknown V types).
- `get_config` — resolved `routesDir`/`libDir`/ports/policy flags.
- `validate_data_contract { route }` — V response struct vs `$props()` fields.
- `scaffold_route { route, mode }` — create `+page.v` + `+page.svelte`
  (`static`/`dynamic`) or API `.v` (`api`).
- `explain_bytecode_error { stack_trace }` — QuickJS `at fn (file:line)`
  frames → snippets; `wasm trap in <fn>` → `.v` file via `.wasm.map`.

## Recipes

- `check` == `swelte check --format json`: same `collectDiagnostics`
  source, same `{ file, line, kind, message }[]` shape. Use the tool
  when connected via MCP; use the CLI in scripts/CI where MCP is absent.

## Rules

- Prefer MCP tools over grepping `src/routes/` by hand — the server
  reuses core's route mapping, so its URLs always match the build.
- `validate_data_contract` before wiring a new `@[load]` to a component.
- `explain_bytecode_error` needs a fresh build: `.wasm.map` files live
  under `.swelte/` and refresh on every `v -b wasm` compile.
- Wasm resolution is fn-level (V emits no DWARF); QuickJS frames are line-level.
