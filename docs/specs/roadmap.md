# Roadmap (open items only)

Built work is in git history + `docs/` user docs
(`../rpc.md`, `../types.md`, `../errors.md`, `../ssr.md`, `../example.md`).
Design rationale lives in `../internal/`. Test suites live next to the
code as `*.test.ts` (all green). This file tracks open work only.

## Tests

Harness (both packages): `node:test` + `node:assert/strict`, TS compiled
to throwaway `dist-test/` via `tsconfig.test.json` (ship `tsc` excludes
`*.test.ts`). No vitest/jest — zero new deps. One command per package:
`npm test` (pretest compiles, test runs `node --test "dist-test/**/*.test.js"`).
Fixtures live next to the code (`*.test.ts` colocated); tmp project roots go
through `node:os tmpdir()` + `fs.mkdtempSync`, never the real `examples/`.

Stated gaps (not planned work): `@[sse]`+verb stack and
`@[sets_cookie]`-on-`+route`-wrapper are dead code at `parseVFile`
(stacking fans out / never attaches) — tests assert the shapes the parser
produces, not the roadmap phrasing; `??T` nests (`string | null | null`,
V never emits it).

### core — pure unit tests (no V binary, no network, no fs outside tmp)

4. **Codegen shape snapshots** — remaining delta: literal golden-string
   comparison of `jsFetchFor`/`jsWasmFor`.

### core — integration tests (needs V binary / network loopback)

Real-binary halves stay in `examples/something` CI, not unit tests.

11. **Codegen golden project** — remaining: sample-overlay variant +
    `routes.js` snapshot.
12. **Contract snapshot flow** — remaining: run through real `runTest`
    with the toolchain.
15. **SSR-manifest consumers** — remaining: dispatch-side presence
    assertion (covered in 11).

Out of scope for unit tests (covered by `swelte test` / example CI):
`v test` execution, real `vite build`, `v -o` link, WASM compile
(`compileLibWasm` needs the V binary), HMR remount, live `dev`/`preview`.

## 9 / SSR — remaining (detail: `ssr.md`)

Open: `qjsc` bytecode (optional cold-start opt, seam ready), dev
`swelte dev` auto-sidecar UX, `ssr-bun` sidecar.

Test (remaining): `!T` → 500 HTML + server up, bare-machine single
artifact, bun streaming.
