# CLI: `swelte` commands

Built behavior. Every command resolves the V toolchain itself
(system `v`, else `@swelte/vvm` — no manual install).

## `swelte dev [--port N] [--backend N] [--root dir]`

One command: V backend (`:backend`) + Vite (`:port`), HMR reload on
`.v` change, Ctrl-C kills both. Runs `generate()` once pre-Vite so
`.swelte/` exists before the V backend boots. Dev sets same-origin
`SWELTE_CORS_ORIGIN` (`http://localhost:<port>`) so the Vite proxy
passes the CSRF guard; config knobs forward to env (env wins when set).
`generate()` is compare-then-write: unchanged output keeps its mtime,
so idle `dev` stays quiet (no phantom HMR), and the watcher ignores
`.swelte/` output — regenerating never re-triggers itself.

## `swelte build [--root dir] [--output path] [--port N] [--target auto|static|node|edge]`

1. `generate()` into `.swelte/` (`routes/*.v` + `server_gen.v` +
   `server.v` harness). Emits dev `.swelte/dev/<mod>.wasm` per file
   (mtime-guarded); the prod bundle compiles in `generateBundle`.
   Also writes `.swelte/entries.json` (prerender crawl list — static
   routes always, dynamics expanded from sibling `entries.ts` only when
   `prerender.entries: 'all'`).
2. `vite build` (wipes `dist/` first — never put the binary inside it
   before this step).
3. QJS bridge pass: adapter's `generateBundle` emits
   `routes/swelte_qjs_bridge.v` + `dist/ssr/render.js`; regenerate so
   `server_gen.v` compiles against it (core-only: idempotent, no bridge).
   Rebuild `libqjs.a` (mtime-guarded).
4. `v -o dist/server .swelte/server.v` (single artifact; QJS projects
   add `-enable-globals -cc <system-gcc>`).
5. Prerender crawl (only when `prerender.entries` is `static`|`all`):
   boot the binary on an ephemeral port, GET each crawl URL, write
   additive `dist/<route>/index.html` (root `/` shell never
   overwritten). `isr` freezes to `SWELTE_ISR` for this env.
   Offline `fallback` file written best-effort from the first page.
6. Target shim (packaging only): `--target` wins, else `swelte.target`
   (`static` → `dist/.swelte-static`, `node` →
   `dist/Dockerfile.swelte`, `edge` → `dist/_headers`).
7. Smoke: boot the binary, probe `/` + `/api/greet` (when the route
   exists), stop. Static shell + JSON only — SSR HTML is the adapter's
   proof, core never starts an engine. `SWELTE_SSR_URL` in the env is
   honored by `Hand` but core sets nothing.

## `swelte test [--root dir] [--update-snapshot | -u]`

1. `generate()` (types must be fresh).
2. `v test` on every dir under `src/lib` + `src/routes` holding `.v`
   files (native, no browser — `*_test.v` files).
3. Contract check: every `.d.ts` fn must exist in its generated stub
   JS (types↔stubs parity), plus `tsc` over `types/`.
4. Shape snapshot: every `.d.ts` projection recorded in
   `<root>/swelte.contract.json` (**committed**, not gitignored —
   drift detection survives a fresh clone; `.swelte/` stays derived).
   Fail on drift; re-run with `--update-snapshot` after an intentional
   V type change to accept.

`SWELTE_CLIENT=1` additionally typechecks the client stubs (default:
server-only).

## `swelte preview [--port N] [--root dir] [--binary path]`

Run the built V binary only (Vite-less prod run). Serves `dist/` +
API on one port. Auto-sets `SWELTE_SSR=1` when the QJS bridge artifact
exists (detection only — core never starts an engine).

## `swelte export [--root dir] [--out snapshot/]`

Snapshot the crawl (packaging only, reuses the build output — no new
enumeration): copies `.swelte/entries.json` + every additive
`dist/*.html` (as `pages/…`) + `swelte.contract.json` into
`<out>/` with a `snapshot.json` manifest (`{ version, target, pages,
at }`). Fails when `.swelte/entries.json` is missing (run `swelte
build` first).

## `swelte check [--root dir] [--format text|json]`

`swelte check` diagnostics without side effects: same scans as
generate-time warns (`gen/diagnostics.ts`), file+line entries for
humans and `--format json` for agents.

## `swelte init [<dir>] [--sample | --empty]`

Scaffold a project. `--sample` (default): the `something` example
shape. `src/main.ts` ships as a thin user-owned shim; routers are
NEVER scaffolded — `dev`/`build` derive them into `.swelte/`.

