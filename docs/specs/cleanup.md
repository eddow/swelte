# Cleanup inventory — deprecated / retired / legacy + `scripts/` audit

Status: §A + §B + §C cleaned (2026-11-22); D decided earlier (folded).
Each item ends with a `- [ ] Decision:` line — tick one per item before deleting anything.

Conventions: "legacy" = still accepted for old projects; "retired" = already
removed, only a guard/error/comment remains; "deprecated" = still works but
documented as do-not-use.

---

## A. CLI / config legacies (still accepted)

### A1. `swelte init` deprecated forwarder
- Where: `engine/core/src/commands/index.ts:83-143` (`initCmd`, summary
  `DEPRECATED: use npm create @swelte`), `COMMANDS` includes `initCmd`.
- Docs: `docs/cli.md`, `docs/README.md` index.
- Behavior: prints "`swelte init` moved … — forwarding", dynamically imports
  `@swelte/create/scaffold`, else throws install hint.
- Removal means: delete `initCmd` + `COMMANDS` entry; update cli docs + README index.
- [x] Decided: REMOVED — `initCmd` deleted from `COMMANDS`; `init` unknown; cli/README/docs-site updated.

### A2. `--lib` / `--kind lib` starter aliases (create + `swelte init`)
- Where: `engine/core/src/commands/index.ts:96-105` (`kind`, `lib` args marked
  "Deprecated … alias"); `engine/create/src/scaffold.ts:2,31-43,72-82`
  (`CreateOpts.kind/lib/template`, `wantLibSample`); `engine/create/src/scaffold.test.ts:77,101`.
- Docs: `docs/libraries.md:49`, docs-site cli page (legacy aliases note).
- Canonical: `--template lib` (reusable-V sample). Aliases only select sample
  content, never a project kind.
- Removal means: drop `kind`/`lib` from `CreateOpts` + both CLIs, keep
  `--template empty|sample|lib`; rewrite the two legacy tests to `--template lib`.
- [x] Decided: REMOVED — `kind`/`lib` dropped from `CreateOpts`, both CLIs and tests; `--template lib` only.

### A3. Top-level `swelte.config.mts` / `.ts` fallback
- Where: `engine/core/src/gen/config.ts:268-305` (`loadConfig` file list +
  "Also honors legacy …" docstring); `engine/core/src/gen/config-norm.test.ts:37-42`.
- Canonical: `svelte.config.js` (`swelte` key) → `package.json` `swelte` key → defaults.
- Removal means: drop the two `swelte.config.*` entries (keep `svelte.config.*`),
  delete the legacy test, trim docstring.
- [x] Decided: REMOVED — `swelte.config.*` unread; tests deleted.

### A4. `src/client.ts` fallback for the client entry
- Where: `engine/core/src/gen/config.ts:722-744` (`renderClientEntry` honors
  legacy `src/client.ts` when `app.ts` absent);
  `engine/core/src/gen/config-norm.test.ts:225`; comments in
  `engine/core/templates/client/main.ts:4-5`,
  `engine/create/templates/base/.swelte/entry-main.ts:6`.
- Canonical: user-owned `src/app.ts` (+ `src/app.css`).
- Removal means: only `src/app.ts` is auto-imported; delete legacy test branch + mentions.
- [x] Decided: REMOVED — `renderClientEntry` only reads `src/app.ts`; legacy test deleted.

### A5. `/src/main.ts` + `/src/app.ts` index.html rewrites
- Where: `engine/core/src/vite/plugin.ts:2308-2318` (`transformIndexHtml`
  rewrites `/src/main.ts`, `/src/app.ts` → `/.swelte/entry-main.ts`).
- Context: pre-`.swelte/entry-main.ts` projects referencing old shims; custom
  entries are left alone.
- Removal means: delete the loop; old projects must point at `/.swelte/entry-main.ts`.
- [x] Decided: REMOVED — `transformIndexHtml` rewrite loop deleted.
### A6. `actionQuery: 'legacy' | 'named'`
- Where: `engine/core/src/gen/config.ts:15,151-156` (type + default
  `compat === 'sveltekit' ? 'named' : 'legacy'`);
  `engine/core/src/vite/types.ts:6-8`; `engine/core/src/vite/plugin.ts:77,243-246,1409,2548`;
  `engine/ssr-qjs/src/vite.ts:15`. Docs: `docs/page-lifecycle.md:126`,
  `docs/forms.md:23`, docs-site lifecycle/forms pages.
- Behavior: `legacy` = `?/save`-style; `named` = SvelteKit `?/save` named actions.
  Default is legacy unless `compat: 'sveltekit'`.
- Removal means: make `named` the only mode (or the default), delete the option
  + all `actionQuery === 'named'` branches + docs mentions.
- [x] Decided: NAMED DEFAULT — `actionQuery` defaults `'named'` everywhere (`compat` no longer changes it); `'legacy'` stays as explicit opt-out. Goldens/tests updated.

### A7. `SWELTE_V_VERSION` duplicated env read (probable copy-paste)
- Where: `engine/vvm/bin/postinstall.js:2,41`
  (`process.env.SWELTE_V_VERSION || process.env.SWELTE_V_VERSION || DEFAULT_V_VERSION`);
  same duplication in `engine/vvm/bin/vvm.js:918-919`. Comment says
  "legacy: SWELTE_V_VERSION" — the second read was meant to be a *different*
  (legacy) name but both sides are now identical.
- Removal means: collapse to a single read (or re-introduce the real legacy
  name if one ever existed — git log it first).
- [x] Decided: COLLAPSED — single `SWELTE_V_VERSION` read in both files.

### A8. `/routes/` line in the scaffolded `.gitignore`
- Where: `engine/create/templates/base/gitignore:3-4` ("legacy generated V
  dispatcher dir (pre-.swelte layout) — must stay empty", `/routes/`).
- Removal means: delete the two lines (output lives in `.swelte/` now).
- [x] Decided: REMOVED — `/routes/` + comment gone from scaffolded `.gitignore`.

### A9. "back-compat" comment in plugin config fallback
- Where: `engine/core/src/vite/plugin.ts:237-239` ("Explicit plugin options
  always win (back-compat)"). Code is current; only the word is legacy.
- [x] Decided: REWORDED — `(back-compat)` dropped (removed with the actionQuery edit).

### A10. Legacy single-marker README region in `deploy`
- Where: `engine/core/src/commands/deploy.ts:317-322`
  (`prev.length // legacy single-marker file: whole tail is managed`).
- Removal means: require both open + close markers; single-marker files get the
  close marker appended (or an error) instead of swallowing the tail.
- [x] Decided: REMOVED FALLBACK — missing close marker = `unchanged`, never swallows the tail.

---

## B. Retired auto-discovery guards (feature gone, guard remains)

### B1. `./swelte/build` auto-discovery guard + no-op stubs
- Where: `engine/core/src/vite/build.ts` (whole file: `loadBuildPhases` throws
  on any dep exporting `./swelte/build`; `phaseDeclarations` / `writePhaseOutputs`
  are no-ops); called from `engine/core/src/vite/plugin.ts:308-311`;
  type comment in `engine/core/src/vite/types.ts:15-18`.
- Test: `engine/core/src/generate-errors.test.ts:474-499`.
- Removal means: delete `build.ts`, drop the plugin call + probe comment,
  delete/retire the test. Consequence: a stale dep shipping `./swelte/build`
  would be silently ignored instead of erroring.
- [x] Decided: REMOVED — `vite/build.ts` deleted (import, call, barrel export gone); retired auto-discovery test deleted. A stale dep shipping `./swelte/build` is now silently ignored.

### B2. `./$types` / `self` / `$ssapi` / `$csapi` resolver tombstone
- Where: `engine/core/src/vite/plugin.ts:2495`
  (`return null // legacy ./$types / self / $ssapi / $csapi removed`);
  `engine/core/src/sdk.ts:1-3` header; `docs/internal/v-imports.md:35-38`.
- Feature already gone; only comments + the `return null` remain.
- [x] Decided: DROPPED — `return null` bare; sdk header trimmed; the `v-imports.md` deletion log stays as the historical record.

### B3. `$types` word in a code comment
- Where: `engine/core/src/vite/plugin.ts:577` ("Per-route params + id
  (SvelteKit `$types` lite)"). Just a SvelteKit analogy, not a compat path.
- [x] Decided: REWORDED — `SvelteKit route-type analogy`.

---

## C. Route / template leftovers

### C1. `index.v` as legacy spelling of `+page.v`
- Where: `engine/core/src/vite/routes.ts:854-858` (leaf = `index` or `+page`);
  `engine/core/src/vite/server-gen.ts:27-28` (emits both pairs);
  `engine/core/src/vite/plugin.ts:1206,1461,1592` (prune/TS/clash comments).
  Docs: `docs/rpc.md:18`, `docs/coming-from-sveltekit.md:22,35`,
  `docs/internal/v-imports.md:60-64` ("Both spellings still accepted (legacy
  back-compat); both present is a build error").
- Removal means: `+page.v` only; `index.v` becomes a normal route stem (or an
  error); update routeFor, server-gen, prune logic, clash message + docs.
- [x] Decided: REMOVED (breaking, pre-1.0) — `routeFor`/`svelteRouteFor`/`svelteModKind`/`leafDirOf` are `+page`-only; `doubleClaimCheck` errors on `index.v` with a rename hint; `index.svelte` also unleafed (literal stem); docs (`rpc`, `coming-from-sveltekit`, `v-imports`) updated; new tests pin `/index` literal routing.

### C2. Old `_x.v` flat-stem prune
- Where: `engine/core/src/vite/plugin.ts:1298-1301` ("any legacy-named output
  (old `_x.v` flat stems) … never leave ghosts"), `:1206`.
- Generate-time hygiene for projects generated by older cores.
- [x] Decided: REWORDED — `_x.v` ghost comment collapsed; wipe semantics kept (harmless without `index.v`).

### C3. "legacy bridge" template comments
- Where: `engine/create/templates/base/.swelte/server.v:1170`,
  `engine/create/templates/base/.swelte/entry-main.ts:6`
  ("or legacy bridge", "legacy src/client.ts fallback" — mirrors A4).
- [x] Decided: REWORDED — `or legacy bridge` dropped in harness template + snapshots (done under §A).

---

## D. `scripts/` audit — every file, wiring, proposed fate

All 18 files are "wired" (via root `package.json`
script or via import from a wired script). No script is referenced from CI
except `sync-version*` (D9). So "unused" here means: manual-only, thin
wrapper, or foldable helper — not unreferenced.

| # | File (lines) | Wired via | Imported by / imports | Proposed fate (to decide) |
|---|--------------|-----------|----------------------|---------------------------|
| D1 | `test-dogfood.mjs` (~340) | `test:dogfood`, `test:dogfood:postgres` (`--postgres-managed`) | imports D2-D7 (dogfood-isr/stream/ssr/shutdown/prerender, dogfood-browser on `--browser`) | KEEP - main native/UI E2E orchestrator |
| D2 | `dogfood-isr.mjs` (40) | via D1 | imported by D1 | KEEP helper, or fold into D1 — decide |
| D3 | `dogfood-stream.mjs` (144) | via D1 | imported by D1 | KEEP helper, or fold into D1 — decide |
| D4 | `dogfood-ssr.mjs` (59) | via D1 | imported by D1 | KEEP helper, or fold into D1 — decide |
| D5 | `dogfood-shutdown.mjs` (91) | via D1 | imported by D1 | KEEP helper, or fold into D1 — decide |
| D6 | `dogfood-prerender.mjs` (65) | via D1 | imported by D1 | KEEP helper, or fold into D1 — decide |
| D7 | `dogfood-browser.mjs` (213) | via D1 (`--browser`) | imported by D1; imports D8 | KEEP helper, or fold into D1 — decide |
| D8 | `dogfood-outbox.mjs` (46) | via D7 | imported by D7 | KEEP helper, or fold into D7/D1 — decide |
| D9 | `sync-version.mjs` (318) + `sync-version.test.mjs` (101) | `version:*` + `.github/workflows/publish-engine.yml` (test + gate) | standalone | KEEP — release tooling, CI-gated |
| D10 | `test-install.mjs` (148) | via `test:e2e` (first step) | standalone | KEEP step (packed SPA+SSR double-install) |
| D11 | `test-e2e.mjs` (new) | `test:e2e` (+ full `test`) | runs D10+D12–D16 sequentially, forwards args | KEEP — single grouped entry point; cherry-pick via `node scripts/<step>.mjs` |
| D12 | `test-dev-lifecycle.mjs` (171) | via `test:e2e` | standalone | KEEP step (was `test:dev`) |
| D13 | `test-images.mjs` (58) | via `test:e2e` | standalone | KEEP step |
| D14 | `test-pack-matrix.mjs` (122) | via `test:e2e` | standalone (superseded deleted `test-ai-pack.mjs`) | KEEP step |
| D15 | `test-jobs.mjs` (73) | via `test:e2e` | standalone | KEEP step |
| D16 | `test-plugin-lifecycle.mjs` (58) | via `test:e2e` | standalone | KEEP step |
| D17 | ~~`test-postgres.mjs` (21)~~ deleted | — (folded) | — | DELETED — folded into D1 as `--postgres-managed` (`test:dogfood:postgres`); BYO-DB via `--postgres` + `DATABASE_URL` |
| D18 | `measure-dogfood.mjs` (173) | `measure:dogfood` only (manual) | standalone | KEEP manual tool (unchanged) |
| D19 | `sync-version.test.mjs` | CI | tests sync-version | KEEP with sync-version |

Notes:
- Full `npm test` is now `test:unit` + `test:e2e` + `test:dogfood` + `test:examples`
  (4 groups, down from 9 commands + manual wrappers).
- [x] Decided: 4 test groups (`test:unit`, `test:e2e`, `test:dogfood`, `test:examples`)
  + manual `measure:dogfood` + `test:dogfood:postgres` variant + `version:*`/
  `prepare:dogfood` tooling. Old cherry-pick commands (`test:install`,
  `test:dev`, `test:images`, `test:pack-matrix`, `test:jobs`, `test:plugins`,
  `test:postgres`) removed; use `node scripts/<step>.mjs` to cherry-pick.
- `test:unit` now covers all engine workspaces (core, plus, mcp, ssr-qjs,
  create, ai) — previously only core + ai.
- Only CI workflow is `publish-engine.yml`, consuming sync-version only.

---

## E. Explicit non-candidates (do NOT remove)

- `compat: 'none' | 'sveltekit'` — current SvelteKit-interop knob, not legacy.
- `docs/*` "legacy" prose documenting real SvelteKit differences
  (`$app/state` stores, `legacy stores` in ssr/page-lifecycle/forms docs) — the
  feature exists; prose stays.
- `engine/ssr-qjs/c/*`, `engine/vvm/bin/thirdparty/*`, `versions/*` — vendored
  third-party; "legacy"/"compat" hits there are upstream wording.
- `engine/*/dist/*`, `dist-test/*`, `.swelte/*` — build output.
- `docs/plus.md` plugin contract + `docs/internal/v-imports.md` §6 decisions log — historical record; keep.

