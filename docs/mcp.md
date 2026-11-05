# Agents: MCP + skills

Built behavior. Two surfaces give agents direct, programmatic insight
into a Swelte project (route tree, type contracts, diagnostics) instead
of guessing from raw text files:

- **MCP server** (`@swelte/mcp`, stdio) — live project queries from the IDE.
- **Skills** (`.agents/skills/`) — six focused playbooks the agent loads
  for scaffolding, routing, SSR, migration, and debugging work.

## MCP server

Transport is **stdio only** — the IDE spawns the server, no ports or auth.

### Client config

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

### `check` == `swelte check --format json`

Same source (`collectDiagnostics`), same `{ file, line, kind, message }[]`
shape — the tool wraps it as `{ diagnostics: [...] }`. Use the tool over
MCP; use `swelte check --format json` in scripts/CI where MCP is absent.

### Wasm maps

Every `v -b wasm` compile emits a name map next to the `.wasm` inside
`.swelte/` (gitignored, never published): dev per-module
`.swelte/dev/<mod>.wasm.map` (+ the kept `<mod>.compile.v` unit) and the
prod bundle `.swelte/app_lib.wasm.map`. `explain_bytecode_error` reads
these to resolve `wasm trap in <fn>` frames to the source `.v` file.
V's wasm backend emits no DWARF/source maps, so resolution is fn-level,
not line-level.

## Skills

Six playbooks ship inside the npm packages (extracted automatically on
`npm install` — see below). Each has a `name` + `description`
frontmatter header so the agent loads it on demand.

| Skill | Ships in | Use when |
|-------|----------|----------|
| `swelte-overview` | `@swelte/core` | Scaffolding, explaining, or navigating a project (routes vs lib layout, CLI commands, `.swelte/` output) |
| `swelte-mcp` | `@swelte/mcp` | Querying a project via the MCP server (route tree, contracts, diagnostics, scaffolding) |
| `swelte-ssr-load` | `@swelte/ssr-qjs` | Adding `@[load]` page data, debugging SSR output, working on server rendering |
| `swelte-svelte5` | `@swelte/core` | Creating/fixing `.svelte` files (runes only, `#routes`/`#lib` imports) |
| `swelte-sveltekit-delta` | `@swelte/core` | Porting a SvelteKit app, checking parity, planning migration |
| `swelte-v-routes` | `@swelte/core` | Creating/fixing `.v` route files (attrs, `SwelteRequest` shape, V→TS types) |

Skills complement the MCP tools: a skill tells the agent *how* to do the
work, the MCP tool gives it the live project facts to work on. Prefer MCP
tools over grepping `src/routes/` by hand; run `validate_data_contract`
before wiring a new `@[load]` to a component.

## Installing skills

Automatic. Scaffolded projects (`swelte init`) carry a `postinstall` hook:

```json
{
  "devDependencies": {
    "npm-skills": "^0.5.1"
  },
  "scripts": {
    "postinstall": "npm-skills extract --skip-production --override"
  },
  "npmSkills": {
    "consume": {
      "only": ["@swelte/*"]
    }
  }
}
```

`npm install` extracts each `@swelte/*` dependency's `skills/` into the project's
`.agents/skills/`. Skills are plain markdown (`SKILL.md` + frontmatter),
versioned with the packages that ship them — no manual copy step.
