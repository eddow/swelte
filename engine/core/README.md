# `@swelte/core`

[![npm version](https://img.shields.io/npm/v/@swelte/core.svg)](https://www.npmjs.com/package/@swelte/core)
[![npm downloads](https://img.shields.io/npm/dm/@swelte/core.svg)](https://www.npmjs.com/package/@swelte/core)

> 📚 [Documentation](https://swelte.emedware.dev/)

Swelte framework core — V + Svelte unified RPC bridge (Vite plugin, client runtime, CLI).

## Entry points (`package.json` exports)

| specifier | file | runs in |
|---|---|---|
| `@swelte/core` | `dist/index.js` | browser + node (sdk only) |
| `@swelte/core/vite` | `dist/vite.js` | node (Vite plugin) |
| `@swelte/core/cli` | `dist/cli.js` | node only (imports `node:*`) |
| `@swelte/core/config` | `dist/gen/config.js` | node (svelte.config.js loading) |
| `@swelte/core/diagnostics` | `dist/gen/diagnostics.js` | node (`swelte check`) |
| `@swelte/core/toolchain` | `dist/toolchain.js` | node (V binary resolution) |
| `swelte` (bin) | `bin/swelte.js` → `dist/cli.js` | shell |

Rule: `index.ts` (browser) must never import `node:*`. CLI/toolchain stay
behind `./cli` so Vite never bundles `node:child_process` into the page
(this bit us once — see session notes).

## Commands

Single `swelte` bin, subcommands (all implemented):

```sh
swelte dev [--port N] [--backend N] [--root dir]
swelte build [--root dir] [--output path] [--port N] [--target auto|static|node|edge]
swelte preview [--port N] [--root dir] [--binary path]
swelte init [<dir>] [--sample | --empty] [--template empty|sample] [--root dir] [--dir name]
swelte check [--root dir] [--format text|json]
swelte test [--root dir] [--update-snapshot | -u]
swelte export [--root dir] [--out snapshot/]
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

## V toolchain (`@swelte/vvm`)

`swelte dev`/`build` resolve `v` itself: system `v` on PATH first, else
the `@swelte/vvm` toolchain (downloaded once into
`node_modules/@swelte/vvm/versions/`). To opt out of the download
(offline CI, pinned system `v`):

```sh
VVM_SKIP_INSTALL=1 npm install
```

Set `SWELTE_V_VERSION=<ver>` to pin a different V version at install time
(default `0.5.2`).

## Design docs

- [RPC](https://github.com/eddow/swelte/blob/main/docs/rpc.md) — `.v` imports, attributes, transport (built)
- [Types](https://github.com/eddow/swelte/blob/main/docs/types.md) — V → TS projection (built)
- [Errors](https://github.com/eddow/swelte/blob/main/docs/errors.md) — envelope, SPA-first rule (built).
