# Handoff — core test suite (2026-11-01, 103/103 green)

## What was done
Implemented roadmap test items 1–10, 12–13, 15 (pure/tmp parts) in
`engine/core`: 14 new `*.test.ts` files, `npm test` → 103 pass / 0 fail.

Files (all colocated, tmp-roots via `mkdtempSync`, no real `examples/`):
- `src/types-matrix.test.ts` — item 1 (`tsTypeFor` rows).
- `src/attr-validation.test.ts` + `src/generate-errors.test.ts` — item 2.
- `src/route-helpers.test.ts` — item 3 (+ double-claim via tmp generate).
- `src/codegen-shape.test.ts` — item 4/11-pure (dispatcher, fetch/SSE,
  WASM stub, byte-identical rerun).
- `src/sdk-errors.test.ts` — item 5. `src/commands/cli-parsing.test.ts` — 6.
- `src/gen/config-norm.test.ts` — 7. `src/gen/diagnostics-parity.test.ts` — 8.
- `src/toolchain-hygiene.test.ts` — 9. `src/commands/dev-ports.test.ts` — 10.
- `src/commands/init-scaffold.test.ts` — 13.
- `src/commands/contract-snapshot.test.ts` — 12 (tmp-root mirror, no V/tsc).
- `src/ssr-manifest.test.ts` — 15.

Testability exports (no logic change): core `tsTypeFor`, `routeForPublic`,
`modulePath`, `vPrefix`, `vFileSafe`; ssr-qjs `stripForScan`,
`posixNormalize`, `withDot`, `stubSdkImports`, `bridgeSrc`.
Roadmap `docs/specs/roadmap.md` updated (Done + per-item deltas).

## Divergences found (tests document, code unchanged)
1. `map[string]T` projects `unknown` (prefix check is backslash-escaped).
2. `??T` nests (`string | null | null`) — V never emits it.
3. `@[sse]`+verb stack / `@[sets_cookie]`-on-wrapper never reach `generate()`.
4. WASM unknown-fn body carries the fetch error, no `available` list.
5. `routeForPublic` copies the closure `routeFor` verbatim (incl.
   `[...rest]`-as-leaf + `files/[...rest].v: malformed` quirk).

## What's next (priority order)
1. **ssr-qjs harness** (roadmap: copy `tsconfig.test.json` + `npm test` script;
   `svelte` + `rollup` are already in the workspace root). Then items 16–22;
   highest value first: 16 (strip/scan), 19 (path keys), 20 (renderFileFor),
   22 (bridgeSrc), 21 (sidecar protocol, real loopback), 17–18
   (guards/rewrite need `svelte/compiler`), 23–26 (integration).
2. **Item 14** (build smoke matrix with mocked binary / `node -e` stub).
3. **Hoist** nested `routeFor`/`jsFetchFor`/`jsWasmFor`/`emitRouteFile` to a
   single exported source (kills the `routeForPublic` copy + `[...rest]` quirk).
4. **Fix or spec** the `map[` prefix check + decide `available` on WASM status-0.
5. Items 11/12/15 V-binary halves (sample overlay, real `runTest`, dispatch
   presence) — example CI, not unit tests.

## How to verify
- `cd engine/core && npm test` → 103/103 (also `npx tsc -p tsconfig.json
  --noEmit` in both `core` and `ssr-qjs` → clean).
- Stray scaffold dirs (`engine/core/{empty,sample,alias,taken}-app`) removed.
