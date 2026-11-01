# MCP: `@swelte/mcp` server

Built behavior. The MCP server gives IDE agents direct, programmatic
insight into a Swelte project (route tree, type contracts, diagnostics)
instead of guessing from raw text files. Transport is **stdio only** —
the IDE spawns the server, no ports or auth.

## Client config

`.vscode/mcp.json`, Claude Code, or equivalent:

```json
{
	"mcpServers": {
		"swelte": {
			"command": "node",
			"args": ["./node_modules/@swelte/mcp/dist/index.js"]
		}
	}
}
```

Or via the bin: `swelte-mcp` (stdio, takes no args).

## Tools

| Tool | What it does |
|------|--------------|
| `list_routes` | Route tree: each `src/routes/**/*.v` mapped to its URL path, RPC functions, and `.svelte` partner |
| `get_route` | One route in detail: V functions with params/return types, structs, and source |
| `check` | `swelte check` diagnostics: orphans, clashes, unknown V types, `backend/` violations |
| `get_config` | Resolved project config (`routesDir`, `libDir`, ports, policy flags) |
| `validate_data_contract` | V response struct vs Svelte 5 `$props()`: matches and mismatches per field |
| `scaffold_route` | Create a route pairing (`+page.v` + `+page.svelte`, or API `.v`): `static` \| `dynamic` \| `api` |
| `explain_bytecode_error` | Map a QuickJS stack trace or wasm trap back to source lines with snippets |

## `check` == `swelte check --format json`

Same source (`collectDiagnostics`), same `{ file, line, kind, message }[]`
shape — the tool wraps it as `{ diagnostics: [...] }`. Use the tool over
MCP; use `swelte check --format json` in scripts/CI where MCP is absent.

## Wasm maps

Every `v -b wasm` compile emits a name map next to the `.wasm` inside
`.swelte/` (gitignored, never published): dev per-module
`.swelte/dev/<mod>.wasm.map` (+ the kept `<mod>.compile.v` unit) and the
prod bundle `.swelte/app_lib.wasm.map`. `explain_bytecode_error` reads
these to resolve `wasm trap in <fn>` frames to the source `.v` file.
V's wasm backend emits no DWARF/source maps, so resolution is fn-level,
not line-level.
