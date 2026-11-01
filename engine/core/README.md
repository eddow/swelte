# `@swelte/core`

Swelte framework core — V + Svelte unified RPC bridge (Vite plugin, client runtime, CLI).

## Layout

```
src/
  sdk.ts        browser runtime: SwelteRpcError, __swelteFetch (#routes/*),
                __swelteWasmCall (#lib/*). No node:* imports — bundled to browsers.
  vite.ts       Vite plugin: *.v resolveId/load codegen, #routes/#lib aliases,
                types + stub emit into .swelte/, dev RPC proxy, #lib/backend guard.
  toolchain.ts  node-only: V binary resolution (PATH or @swelte/vvm).
  cli.ts        `main(argv)`: dispatch to commands/*.
  commands/     one module per subcommand (dev|build|preview|init|check|test) + types.ts (argv parser).
  gen/          config.ts (svelte.config.js loading), diagnostics.ts (swelte check),
                paths.ts (pure backend-path helper, browser-safe).
  index.ts      browser entry: sdk + VERSION only (never import node code here).
bin/
  swelte.js     ~6-line shim importing ../dist/cli.js (npm needs a runnable file
                before tsc runs; tracked in git — only dist/ is ignored).
```

## Entry points (`package.json` exports)

| specifier | file | runs in |
|---|---|---|
| `@swelte/core` | `dist/index.js` | browser + node (sdk only) |
| `@swelte/core/vite` | `dist/vite.js` | node (Vite plugin) |
| `@swelte/core/cli` | `dist/cli.js` | node only (imports `node:*`) |
| `@swelte/core/config` | `dist/gen/config.js` | node (svelte.config.js loading) |
| `@swelte/core/toolchain` | `dist/toolchain.js` | node (V binary resolution) |
| `swelte` (bin) | `bin/swelte.js` → `dist/cli.js` | shell |

Rule: `index.ts` (browser) must never import `node:*`. CLI/toolchain stay
behind `./cli` so Vite never bundles `node:child_process` into the page
(this bit us once — see session notes).

## Commands

Single `swelte` bin, subcommands (all implemented):

```
swelte dev [--port N] [--backend N] [--root dir]
swelte build [--root dir] [--output path] [--port N]
swelte preview [--port N] [--root dir] [--binary path]
swelte init [<dir>] [--sample | --empty] [--template empty|sample]
swelte check [--root dir] [--format text|json]
swelte test [--root dir] [--update-snapshot | -u]
swelte --help | --version
```

Notes:
- `build` smoke-probes `/` always; the `/api/greet` API probe runs only
  when the route exists (empty scaffold has no `api/greet.v`).
- `test` snapshot lives at `<root>/swelte.contract.json` (committed) —
  pass `--update-snapshot` after an intentional V type change.
- Port cleanup is best-effort and portable: child handles first, `ss`/`fuser`/`pkill`
  only on Unix when present. Documented as Unix-friendly, macOS/Windows work
  without the optional tools.

## Build / dev

```sh
npm run build   # tsc -p tsconfig.json → dist/
npm run dev     # tsc --watch
```

## Design docs

- `../../docs/rpc.md` — `.v` imports, attributes, transport (built)
- `../../docs/types.md` — V → TS projection (built)
- `../../docs/errors.md` — envelope, SPA-first rule (built)
- `../../docs/internal/v-imports.md` — design rationale + decisions log
- `../../docs/specs/sveltekit.md` + `../../docs/specs/moar.md` — forward work
