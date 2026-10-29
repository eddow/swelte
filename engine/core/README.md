# `@swelte/core`

Swelte framework core — V + Svelte unified RPC bridge (Vite plugin, client runtime, CLI).

## Layout

```
src/
  sdk.ts        browser runtime: SwelteRpcError, __swelteFetch (#routes/*),
                __swelteWasmCall (#lib/*). No node:* imports — bundled to browsers.
  vite.ts       Vite plugin: *.v resolveId/load codegen, #routes/#lib aliases,
                types + stub emit into .swelte/, dev RPC proxy, #lib/server guard.
  toolchain.ts  node-only: V binary resolution (PATH or @swelte/vvm).
  cli.ts        `main(argv)`: dispatch to commands/*.
  commands/     one module per subcommand (dev|build|preview|init|check) + types.ts (argv parser).
  index.ts      browser entry: sdk + VERSION only (never import node code here).
bin/
  swelte.js     ~6-line shim importing ../dist/cli.js (npm needs a runnable file
                before tsc runs; gitignored, regenerable).
```

## Entry points (`package.json` exports)

| specifier | file | runs in |
|---|---|---|
| `@swelte/core` | `dist/index.js` | browser + node (sdk only) |
| `@swelte/core/vite` | `dist/vite.js` | node (Vite plugin) |
| `@swelte/core/cli` | `dist/cli.js` | node only (imports `node:*`) |
| `swelte` (bin) | `bin/swelte.js` → `dist/cli.js` | shell |

Rule: `index.ts` (browser) must never import `node:*`. CLI/toolchain stay
behind `./cli` so Vite never bundles `node:child_process` into the page
(this bit us once — see session notes).

## Commands

Single `swelte` bin, subcommands (all stubs except dispatch until roadmap items 2–5, 15 land):

```
swelte dev [--port N] [--backend N] [--root dir]
swelte build [--root dir]
swelte preview [--port N] [--root dir]
swelte init [--root dir]
swelte check [--root dir]
swelte --help | --version
```

## Build / dev

```sh
npm run build   # tsc -p tsconfig.json → dist/
npm run dev     # tsc --watch
```

## Design docs

- `../../docs/rpc.md` — `.v` imports, attributes, transport (built)
- `../../docs/types.md` — V → TS projection (built)
- `../../docs/errors.md` — envelope, SPA-first rule (built)
- `../../docs/specs/v-imports.md` — design rationale + decisions log
- `../../docs/specs/roadmap.md` — forward work only (items 2–5, 15 land here as `src/commands/*`)
