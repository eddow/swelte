Finishing review of engine/core — checking the final files. 

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core"
}

Pulling the core files for a final pass. 

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/README.md"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/package.json"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/index.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/sdk.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/toolchain.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/vite.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/cli.ts"
}

Finishing touches — mapping the last files to review. 

Ran terminal command: ls -R /home/fmdm/dev/swelte/engine/core/src /home/fmdm/dev/swelte/engine/core/templates 2>&1 | head -n 100; echo ---; cat /home/fmdm/dev/swelte/engine/core/tsconfig.json; echo ---; cat /home/fmdm/dev/swelte/engine/core/bin/swelte.js

Your finishing review is underway — I'm reading through the core files now. 

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/sdk.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/index.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/types.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/gen/config.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/gen/diagnostics.ts"
}

Finishing review underway — pulling the remaining core modules. 

Read , lines 1 to 200
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/sdk.ts",
  "view_range": [
    1,
    200
  ]
}

Read , lines 1 to 250
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/gen/diagnostics.ts",
  "view_range": [
    1,
    250
  ]
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/dev.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/build.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/init.ts"
}

Wrapping up the core review — scanning the big plugin and remaining commands. 

Ran terminal command: cd /home/fmdm/dev/swelte/engine/core && wc -l src/*.ts src/**/*.ts templates/**/* 2>/dev/null | sort -n | tail -n 30; echo ===; npm run build 2>&1 | tail -n 30

Build is clean. Now digging into the big one — `vite.ts`. 

Ran terminal command: cd /home/fmdm/dev/swelte/engine/core && grep -n "^export \(function\|const\|async function\|interface\|type\|class\)\|^function " src/vite.ts | head -n 60; echo ===; grep -n "TODO\|FIXME\|XXX\|HACK\|any\b" src/vite.ts | head -n 30

Reviewing the last batch of core files — dev, preview, test, and the Vite plugin core. 

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/dev.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/preview.ts"
}

Read 
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/test.ts"
}

Finishing review underway — pulling the remaining core modules. 

Read , lines 1 to 250
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/vite.ts",
  "view_range": [
    1,
    250
  ]
}

Read , lines 1 to 150
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/dev.ts",
  "view_range": [
    1,
    150
  ]
}

Read , lines 200 to 429
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/sdk.ts",
  "view_range": [
    200,
    429
  ]
}

Finishing review underway — pulling the remaining core modules. 

Read , lines 493 to 750
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/vite.ts",
  "view_range": [
    493,
    750
  ]
}

Read , lines 427 to 430
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/sdk.ts",
  "view_range": [
    427,
    430
  ]
}

Read , lines 150 to 357
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/commands/dev.ts",
  "view_range": [
    150,
    357
  ]
}

Read , lines 250 to 341
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/gen/diagnostics.ts",
  "view_range": [
    250,
    341
  ]
}

Finishing review underway — now mapping the big Vite plugin internals. 

Ran terminal command: cd /home/fmdm/dev/swelte/engine/core && grep -n "^\t\(async \)\?function \|^\t\(async \)\?[a-zA-Z_]*(\|return {\|resolveId\|load(\|transform\|configureServer\|generateBundle\|buildStart\|configResolved\|handleHotUpdate" src/vite.ts | head -n 100

Almost done mapping — checking the plugin hooks and codegen flow. 

Read , lines 2704 to 2900
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/vite.ts",
  "view_range": [
    2704,
    2900
  ]
}

Finishing review underway — pulling the remaining core modules. 

Read , lines 420 to 430
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/sdk.ts",
  "view_range": [
    420,
    430
  ]
}

Read , lines 3048 to 3181
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/vite.ts",
  "view_range": [
    3048,
    3181
  ]
}

Ran terminal command: cd /home/fmdm/dev/swelte/engine/core && ls dist/ 2>&1 | head; echo ===; cat tsconfig.json; echo ===; grep -rn "from '../vite" src/gen/ src/commands/ | head; echo ===; grep -n "parseStructs\|parseVFile\|tsTypeFor" src/vite.ts | head -n 20

Finishing review underway — verifying the last few blockers before I write it up. 

Ran terminal command: cd /home/fmdm/dev/swelte/engine/core && cat .gitignore 2>/dev/null; git check-ignore -v bin/swelte.js dist/cli.js 2>&1; echo ===; grep -n "wasmDevMiddleware\|configureServer" src/vite.ts | head; echo ===; sed -n '2917,3050p' src/vite.ts

Finishing review underway — verifying the last few blockers before I write it up. 

Ran terminal command: cd /home/fmdm/dev/swelte/engine/core && cat .gitignore; echo ===; git status --short | head -n 20; echo ===; git check-ignore -v bin/swelte.js; echo ===; grep -n "async function generate\|function generate\|function routeFor\|function jsFetchFor\|function jsWasmFor\|function routeGen\|function serverGen" src/vite.ts | head

Finishing review underway — verifying the last few blockers before I write it up. 

Ran terminal command: cat .gitignore 2>/dev/null; echo ===ROOT_GITSTATUS===; git status --short | head -n 30; echo ===; git check-ignore -v engine/core/bin/swelte.js engine/core/dist/cli.js 2>&1; echo ===TSCONFIG_BASE===; cat tsconfig.base.json

Finishing review underway — verifying the last few blockers before I write it up. 

Ran terminal command: git ls-files engine/core/bin/; echo ===; ls -la engine/core/bin/; echo ===; git diff --stat; echo ===; find engine/core -name "*.test.*" -o -name "*.spec.*" | head; echo ===; grep -rn "greet" engine/core/src/commands/build.ts | head; echo ===; git diff engine/core/templates/harness/server.v | head -n 60

Finishing review underway — verifying the last few blockers before I write it up. 

Read , lines 1716 to 1900
Completed with input: {
  "path": "/home/fmdm/dev/swelte/engine/core/src/vite.ts",
  "view_range": [
    1716,
    1900
  ]
}

# `engine/core` finishing review

Build passes (`tsc -p tsconfig.json`). Structure is sound: browser-safe `index.ts` (`sdk` only, no `node:*`), node behind `./cli`, `./vite`, `./config`, `./toolchain`. Findings below, ordered by severity.

## Blockers

- **Build smoke assumes sample route.** `build.ts` probes `/api/greet?payload="w"` unconditionally. Empty scaffold (`templates/base`) has no `api/greet.v`, so `swelte build` fails its own smoke. Make the API probe conditional on the route existing, or probe `/` + JSON only.
- **Linux-only process tools.** `dev`/`build`/`preview` shell out to `fuser`, `ss`, `pkill`, `curl` (`dev.ts`, `build.ts`). Breaks macOS/Windows. Either document Unix-only or replace with portable `fetch` + `server.close`.
- **`watch(recursive:true)` doesn't recurse on Linux.** `dev.ts` misses nested `routes/**` changes on Linux. Use `chokidar` or manual recursive watchers.
- **Hardcoded kill pattern.** `dev.ts` `pkill -f 'examples/something/something'` leaks example naming into every project. Derive from `root` or drop it (`fuser` + child handles suffice).
- **`config` errors swallowed.** `config.ts` `catch { return defaults }` hides `svelte.config.js` syntax errors as silent defaults. Log a warning at minimum.
- **Snapshot in gitignored dir.** `test.ts` writes `contract-snapshot.json` under `.swelte/` (gitignored), so drift detection resets on every fresh clone. Move snapshot out of `.swelte/` or document as local-only; prefer `--update-snapshot` over `rm ... && swelte test`.

## Should fix

- **Dead code in `vite.ts`:** top-of-file `void` suppressions (`_createRequire`, `dirname`, `execVSync`, `vBin`, `resolveV`) despite later real use; unused `wasmDevMiddleware` noop (`vite.ts`). Remove both.
- **`configureServer` watches wrong dirs.** `vite.ts` uses bare `resolve(routesDir)` (cwd-relative) instead of `server.config.root`. Breaks language-server / non-cwd roots.
- **`check` vs `generate` drift.** `diagnostics.ts` claims to mirror `generate()` warns but skips SSE shape validation (emit vs `[]string` throw in `generate`). Add the same check or downgrade the claim.
- **Backend-path helper tripled.** `isBackendMod` in `vite.ts` + `diagnostics.ts`, `isLibServerPath` in `sdk.ts` (name admits it is legacy). Share one helper from `gen/config.ts`.
- **Missing child `error` handlers.** `spawn(v...)` / `spawn(npx vite...)` in `dev`/`preview`/`build` listen for `exit` but not `error` — `v` missing (`resolveV` fallback `'v'`) becomes an unhandled error. Add `on('error')` → readable message.
- **`--flag=false` quirk.** `types.ts` treats any `--flag=X` except literal `false` as `true` (`--flag=0` → `true`). Accept `0`/`no` as false.

## Nits / docs

- `README.md` is stale: says commands are "all stubs" (they are implemented: `dev|build|preview|init|check|test`), omits `./config` + `./toolchain` exports, and claims `bin/swelte.js` is "gitignored" — it is tracked (`git ls-files` shows it; only `dist/` is ignored). Update before tagging.
- `package.json` `typesVersions` maps only `cli`; add `vite`/`config`/`toolchain` or drop the block (adjacent `.d.ts` already resolves under `NodeNext`).
- No unit tests in `core/` (`*.test.*` absent). `tsc` + `swelte test` cover integration, but `parseVFile`/`parseArgs`/`doubleClaimCheck` deserve a few pure-function tests.

```typescript
// smallest high-value fixes: conditional smoke, warn on config error,
// root-anchored watcher, portable fetch probe
```

Verdict: close — fix the smoke probe, watcher recursion, and portability items, then refresh the README and ship.
