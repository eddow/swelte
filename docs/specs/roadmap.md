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

### core — pure unit tests (no V binary, no network, no fs outside tmp)

1. **V → TS projection matrix** (`tsTypeFor` via `parseVFile`/`parseStructs`):
   every row in `docs/types.md` — `int`/`i64`/`u32` → `number`, `bool`,
   `time.Time` → `number`, `[]u8` → `string`, `[]T` → `T[]`, `map[string]T`,
   `?T` → `T | null`, `!T` fallible flag, `json.Any` → `unknown`,
   named struct → same-name interface, `json.Any` → `unknown`.
   (Needs `export` on the pure helpers first: `tsTypeFor`, `routeFor`,
   `modulePath`, `vPrefix`, `vFileSafe`, `jsFetchFor`, `jsWasmFor`, plus the
   same for ssr-qjs `stripForScan`/`posixNormalize`/`withDot` — no logic
   change, just testability. `emitRouteFile` is nested in `generate()`;
   either hoist it or cover it through item 11's golden project.)
2. **Attr fan-out + validation errors**: stacked `@[rpc; sse]` → two fns;
   two `@[load]` per file throws; `@[load]` stacked with verb throws;
   `@[sse]` stacked with verb throws; two `@[get]` defaults throws;
   duplicate `@[get('q')]` throws; `@[before]` wrong signature throws;
   `@[after]` wrong return throws; `@[sets_cookie]` on middleware throws.
3. **Route helpers**: `routeFor` (leaf `/x`, `/`, dynamic `[id]`/`[...rest]`,
   `api/` prefix, `+route` wrapper → null); `modulePath`, `vPrefix`,
   `vFileSafe` (no `/` collisions); `svelteModKind`/`svelteRouteFor`
   (page/wrapper/error/plain/null); folder-root double-claim
   (`foo.v` vs `foo/+page.v`, either extension, wrapper exempt).
4. **Codegen shape snapshots**: `jsFetchFor` (dyn params, SSE generator,
   qualifier plumbing) and `jsWasmFor` compared as golden strings for one
   route file + one lib file; `emitRouteFile` dispatcher contains
   `swelte_route`/`swelte_sse_*`/`swelte_load_for` entry points.
5. **SDK error contract** (`sdk.ts`, fetch mocked): `SwelteRpcError` message
   includes fn/base/status/available/hint; 404 JSON body parsed vs raw text
   fallback; `loadPage` maps `SwelteRpcError` → `{ error: { status, message } }`,
   non-RPC throw → 500; `isPageError`/`isPageData` narrow correctly.
   WASM path: `__swelteWasmCall` fallback map hit without fetch; unknown fn
   without fallback → status-0 shape with `available`.
6. **CLI parsing** (`commands/types.ts`, `cli.ts` dispatch): unknown command
   → exit 1 + help; `--port=abc` → number error; short flags; `check --format
   bogus` throws; `helpText`/`commandHelp` list all six commands.
7. **Config normalization** (`gen/config.ts` with tmp roots): missing file →
   defaults; `swelte` key read (non-enumerable `defineConfig`); legacy
   top-level `swelte.config.ts`; broken config warns (capture `console.warn`)
   and falls back; `renderClientEntry` prepends hook only when
   `src/client.ts` exists.
8. **Diagnostics parity** (`gen/diagnostics.ts` vs `generate()` on tmp
   fixtures): orphan route, duplicate qualifier, unknown V type, ignored
   `#lib` attr, `backend/` TS file — each yields the documented `kind`;
   assert SSE *shape* stays out (documented subset, build-error only).
9. **Toolchain PATH hygiene** (`toolchain.ts`, pure parts): `sanitizedPath`
   strips conda/miniconda/mamba (case-insensitive), drops empties, falls back
   to system dirs on conda-only PATH; `toolchainEnv` preserves extra vars.
10. **Dev port helpers** (`commands/dev.ts`, no real binds except `portFree`
    on port 0): `takePort` fallbacks/NaN/negative; `portFree(0)` true;
    `projectKillPattern` returns basename; `onSpawnError` logs readable hint.

### core — integration tests (needs V binary / network loopback)

11. **Codegen golden project**: run `generate()` on a tmp scaffold (empty +
    sample overlay), snapshot `.swelte/` file list + one dispatcher +
    `routes.js` + `ssr-manifest.json`; rerun is byte-identical (order-stable).
12. **Contract snapshot flow**: `swelte.contract.json` write → clean rerun →
    drift (edit one `.v` return) → error names the file → `--update-snapshot`
    rewrites. Uses tmp root, not `examples/`.
13. **`swelte init` scaffolds**: empty (no `src/routes/api`), sample
    (greet route present), `__NAME__` replaced, non-empty target throws;
    interactive prompt bypassed via `--empty`/`--sample` in tests.
14. **Build smoke matrix** (mocked binary or `node -e` stub server):
    page 200 always; `/api/greet` probed only when the route file exists
    (empty scaffold skips API); JSON accept path logged. Real-binary half
    stays in `examples/something` CI, not unit tests.
15. **SSR-manifest consumers**: `collectSvelteManifest` on tmp routes —
    wrapper chain order, `+error` global-only rule (nested throws),
    headless API route excluded from entries but present in dispatch.

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
