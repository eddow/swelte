# Roadmap (open items only)

Built work is recorded in git history + `docs/` user docs
(`../rpc.md`, `../types.md`, `../errors.md`, `../ssr.md`, `../example.md`).
Design rationale lives in `../internal/`. This file tracks open work only.

## Tests

Harness (both packages): `node:test` + `node:assert/strict`, TS compiled
to throwaway `dist-test/` via `tsconfig.test.json` (ship `tsc` excludes
`*.test.ts`). No vitest/jest — zero new deps. One command per package:
`npm test` (pretest compiles, test runs `node --test "dist-test/**/*.test.js"`).
Fixtures live next to the code (`*.test.ts` colocated); tmp project roots go
through `node:os tmpdir()` + `fs.mkdtempSync`, never the real `examples/`.

### Done (keep green)

- `core`: `parseArgs`/`parseBoolFlag` (`commands/types.test.ts`), `parseVFile`
  + `parseStructs` against real `greet.v` shapes (`parse.test.ts`),
  `isBackendMod` (`gen/paths.test.ts`). 11/11 passing.
- Roadmap items 1–10, 12–13, 15 (pure parts) — **103/103 passing**
  (`npm test` in `engine/core`, 2026-11-01). New files:
  `src/types-matrix.test.ts` (item 1: every `docs/types.md` row — with two
  documented divergences: `map[…]` projects `unknown` today, `??T` nests),
  `src/attr-validation.test.ts` + `src/generate-errors.test.ts` (item 2),
  `src/route-helpers.test.ts` (item 3, incl. folder-root double-claim via
  tmp `generate()`), `src/codegen-shape.test.ts` (item 4: dispatcher entry
  points + fetch/SSE/qualifier shapes + golden byte-identical rerun),
  `src/sdk-errors.test.ts` (item 5), `src/commands/cli-parsing.test.ts`
  (item 6), `src/gen/config-norm.test.ts` (item 7),
  `src/gen/diagnostics-parity.test.ts` (item 8: orphan / folder-clash /
  unknown-type / ignored-`#lib`-attr / backend-TS; SSE shape stays out),
  `src/toolchain-hygiene.test.ts` (item 9),
  `src/commands/dev-ports.test.ts` (item 10),
  `src/commands/init-scaffold.test.ts` (item 13: empty vs sample,
  `__NAME__`, non-empty guard, `--empty`/`--sample`/`--template` bypass),
  `src/commands/contract-snapshot.test.ts` (item 12: write → clean →
  drift-names-file → `--update-snapshot`, tmp-root mirror of `runTest`
  steps 3–4 without the V binary / `tsc`),
  `src/ssr-manifest.test.ts` (item 15: wrapper order, `+error` global-only,
  headless-API exclusion, dynamic verbatim).
  Testability exports (no logic change): core `tsTypeFor`,
  `routeForPublic`, `modulePath`, `vPrefix`, `vFileSafe`
  (closure `routeFor` kept; `jsFetchFor`/`jsWasmFor` covered via item 11-style
  golden stubs); ssr-qjs `stripForScan`, `posixNormalize`, `withDot`,
  `stubSdkImports`, `bridgeSrc`.
  Not covered (stated gaps): `@[sse]`+verb stack and `@[sets_cookie]`-on-
  `+route`-wrapper are dead code at `parseVFile` (stacking fans out /
  never attaches) — tests assert the shapes the parser produces, not the
  roadmap phrasing; `routeForPublic` wraps the closure copy (incl. its
  `[...rest]`-as-leaf quirk) rather than a hoisted single source.

### core — pure unit tests (no V binary, no network, no fs outside tmp)

> Status 2026-11-01: items 1–10 DONE (103/103 green, see Done above).
> What remains in each item is the delta in parentheses.

1. **V → TS projection matrix** — DONE. (Divergences documented in tests:
   `map[string]T` → `unknown`, `??T` nests.)
2. **Attr fan-out + validation errors** — DONE except the two dead-code
   phrasings (`@[sse]`+verb stack, `@[sets_cookie]`-on-wrapper never reach
   `generate()` — `parseVFile` fans/ignores first). Covered instead: middleware
   in leaf files, `@[after]` param shape, all load/qualifier/default rules.
3. **Route helpers** — DONE (`routeForPublic` wraps the closure copy).
   Remaining: hoist nested `routeFor`/`jsFetchFor`/`jsWasmFor`/`emitRouteFile`
   to a single source if the `[...rest]`-as-leaf quirk ever matters.
4. **Codegen shape snapshots** — DONE via golden `generate()` (dispatcher
   entry points, fetch/SSE/qualifier, WASM stub, byte-identical rerun).
   Remaining: literal golden-string comparison of `jsFetchFor`/`jsWasmFor`.
5. **SDK error contract** — DONE (WASM unknown-fn asserts status-0 shape;
   roadmap's "with `available`" does not hold — body carries the fetch error).
6. **CLI parsing** — DONE.
7. **Config normalization** — DONE.
8. **Diagnostics parity** — DONE (duplicate-qualifier is a generate-time
   build error, not a diagnostic `kind`; folder-clash covered instead).
9. **Toolchain PATH hygiene** — DONE.
10. **Dev port helpers** — DONE.

### core — integration tests (needs V binary / network loopback)

> Status 2026-11-01: items 11–13, 15 DONE at the pure/tmp level (no V
> binary). Item 14 untouched; the "needs V binary" halves below remain.

11. **Codegen golden project** — DONE (pure/tmp half: `codegen-shape.test.ts`
    runs `generate()` on a tmp scaffold, asserts dispatcher + `ssr-manifest`,
    rerun byte-identical). Remaining: sample-overlay variant + `routes.js`
    snapshot.
12. **Contract snapshot flow** — DONE (tmp-root mirror without the V binary /
    `tsc`). Remaining: run through real `runTest` with the toolchain.
13. **`swelte init` scaffolds** — DONE (empty/sample/`__NAME__`/non-empty guard,
    prompt bypassed). Remaining: nothing open.
14. **Build smoke matrix** (mocked binary or `node -e` stub server) — OPEN:
    page 200 always; `/api/greet` probed only when the route file exists
    (empty scaffold skips API); JSON accept path logged. Real-binary half
    stays in `examples/something` CI, not unit tests.
15. **SSR-manifest consumers** — DONE (`collectSvelteManifest` on tmp routes:
    wrapper entries, `+error` global-only, headless-API exclusion, dynamic
    verbatim). Remaining: dispatch-side presence assertion (covered in 11).

Out of scope for unit tests (covered by `swelte test` / example CI):
`v test` execution, real `vite build`, `v -o` link, WASM compile
(`compileLibWasm` needs the V binary), HMR remount, live `dev`/`preview`.

## 9 / SSR — remaining (detail: `ssr.md`)

Open: `qjsc` bytecode (optional cold-start opt, seam ready), dev
`swelte dev` auto-sidecar UX, `ssr-bun` sidecar, §5 gate as CI.

Test (remaining): `!T` → 500 HTML + server up, bare-machine single
artifact, HMR no-restart proof, bun streaming.

## 23. V runtime as static vlib (deferred, post-freeze)

Keep emitting `SwelteRequest` + `err_*` from `generate()` until shape freezes; then ship
static `engine/core/vlib/request.v` copied verbatim (content-hashed, no `-I` into
`node_modules`).

Test: delete `.swelte/routes/`, rebuild — `Request` hash unchanged; build works off the copy.

## Test appendix — ssr-qjs (pure + integration)

Harness: same `node:test` + `dist-test/` setup as core (needs its own
`tsconfig.test.json` + `npm test` script — copy the pattern).

### ssr-qjs — pure unit tests (no QJS link, no rollup, no network)

> Status 2026-11-01: harness NOT YET set up; testability exports ARE in
> (`stripForScan`, `posixNormalize`, `withDot`, `stubSdkImports` exported
> from `ssr.ts`; `bridgeSrc` exported from `qjs.ts` — no logic change).
> Items 16–22 below are fully OPEN, ordered by value.

16. **Scan + strip** (`stripForScan`): `//comment fetch(` not flagged,
    `"fetch("` string not flagged, backtick template preserved, line numbers
    survive (1:1 map), `keepStrings` keeps `node:` content for externals scan.
17. **QJS-compat guards** (each a tmp `.svelte` string, assert file+line):
    top-level `fetch(` rejected, `fetch` in handler allowed; top-level
    `await` rejected; `node:fs` import rejected (string survives strip);
    SDK import allowed but top-level stub *call* rejected
    (`assertNoTopLevelStubCalls` — `import { greet }` + `greet()` at setup
    throws, same call inside `onclick` passes); aliased import
    (`import { greet as g }`) tracked.
18. **Import rewrite** (`stubSdkImports`/`compileSsrComponent` with svelte
    mocked or fixture-only): SDK imports become throw-stubs naming the file;
    non-SDK imports untouched; `import type` erased path covered.
19. **Path keys** (`posixNormalize`/`withDot`): `../+error.svelte` from
    `./admin/+page.svelte` → `./+error.svelte`; already-`./` untouched;
    route table maps `/` + `/admin` + dynamic shapes verbatim.
20. **`renderFileFor` selection**: dev bundle preferred when `preferProd`
    false; prod `dist/ssr/render.js` when true; missing both → dev path
    (caller handles ENOENT, no throw here). `defaultSsrDevPort` is 8132.
21. **Sidecar protocol** (`dev.ts` with real loopback `startSsrDevServer` +
    stub `render.js`): `POST /` → `{ html, head }`; bad JSON → 400; body >
    1MB → 413; wrong method → 404; missing render file → 503; render timeout
    → 500, server stays up. Render-time throw in stub → 500 JSON, no crash.
22. **Bridge source shape** (`bridgeSrc` in `qjs.ts`): contains
    `swelte_qjs_render_page`, timeout/mem constants interpolated, single-artifact
    comment; no assertion on C compile (needs gcc + vendored sources).

### ssr-qjs — integration tests (needs build artifacts / sidecar)

23. **Full compose on tiny fixture** (two routes + error, real
    `svelte/compiler` + rollup): `composeRenderJs` output contains
    `renderRoute`, route table, `data-swelte-ssr="1"` marker; `bundleSsr`
    output has no `node:` strings; `emitRenderJs` prod cleans `dist/ssr/`
    to exactly one file.
24. **`runSsrCheck` halves** (already implemented in `cli.ts`, promote to
    CI): sidecar HTML marker + `/nope` +error + JSON-accept bypass + 20×
    repeat render; sidecar-via-Hand; prod-binary (when `dist/server` exists).
    Missing halves log `skipping …`, never fail the suite.
25. **QJS prod link** (`buildQjsProd`, gcc-gated `describe.skip` when no cc):
    `.a` built once (mtime guard skips rebuild), bridge written under
    `<outDir>/routes/swelte_qjs_bridge.v`, flags string has `-lqjs -lm`.
26. **HMR no-restart proof** (open roadmap item): touch a `.svelte`, sidecar
    re-imports by mtime, second render reflects the change, V backend untouched.
