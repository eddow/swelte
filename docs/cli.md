# CLI: `swelte` commands

Built behavior. Every command resolves the V toolchain itself
(system `v`, else `@swelte/vvm` — no manual install). Subcommand list
is closed: `dev` / `build` / `preview` / `deploy` / `test` / `check` /
`export` / `migrate` (+ `--help` / `--version`), plus a deprecated `init`
forwarder to `npm create @swelte` (`@swelte/create`). Third-party plugins
may extend it via `SWELTE_PLUGINS` (comma/space-separated specifiers).
No aliases — the documented
`--target` is the deploy-target shim; `--target-os` is the cross-build
OS (build-only, see below).

## `swelte dev [--port N] [--backend N] [--root dir] [--ssr-port N] [--ssr|--no-ssr]`

One command: V backend (`:backend`) + Vite (`:port`), HMR reload on
`.v` change, Ctrl-C closes the session. Vite initializes the configured
Swelte plugin before the native backend is compiled. Dev sets same-origin
`SWELTE_CORS_ORIGIN` (`http://localhost:<port>`) so the Vite proxy
passes the CSRF guard; config knobs forward to env (env wins when set).
`generate()` is compare-then-write: unchanged output keeps its mtime,
so idle `dev` stays quiet (no phantom HMR), and the watcher ignores
`.swelte/` output — regenerating never re-triggers itself.

Dev starts Vite through its Node API in a worker thread, then generates and
compiles a separate native candidate for each backend generation. The running
application continues serving during compilation. Failed builds leave it
running; successful builds request cooperative shutdown over a private,
authenticated loopback connection. Only after the old process exits does the
controller launch the candidate directly and await its explicit `ready` event.
No compiler or npm wrapper owns the application process. Candidates live in a
unique session directory under the configured output directory and are removed
when discarded or stopped, including on Windows.

`r` rebuilds and replaces the backend; `u` calls Vite's restart API; `q` quits
(no Enter required). File edits and keyboard restarts share one controller:
requests are coalesced, obsolete candidates are discarded, and replacements
never overlap. Every queued backend build regenerates `.swelte/` first, and the
plugin's own file watcher skips autonomous regen under `dev` — one writer, so
the native compiler never reads half-written output. Quit cancels pending
replacements and joins active work. A lost controller connection makes the
native application stop itself, even during startup. Vite and the optional SSR
sidecar close when the controller exits.

Normal restart and quit send no OS signals to the application. The existing
`SWELTE_SHUTDOWN_TIMEOUT_MS` budget (default 10000) covers native draining and
cleanup; only a hung owned child is forcibly terminated after that budget plus
a 500ms margin. Occupied ports cause an error; Swelte never kills their owners
or searches process command lines. Preview shares the occupied-port policy.

`npm run test:dev` exercises the real native controller lifecycle in a disposable
project, including failed builds, graceful drain, controller loss and quit
during startup. It requires the V toolchain and uses portable Node APIs.

SSR is automatic when the adapter is installed: `swelte dev` probes
`@swelte/ssr-qjs` from the project root (no new dep for core, resolved
via `createRequire` — uninstalling the adapter is the SPA opt-out).
When found it emits `.swelte/dev/render.js`, boots the dev sidecar
(default `:8132`, `--ssr-port` / `SWELTE_SSR_PORT` override), and hands
its URL to the V backend as `SWELTE_SSR_URL` (explicit env always wins,
e.g. an external renderer). `Hand` then proxies renders; without the
adapter (or with `--no-ssr`) the URL stays unset and dev is SPA/static
+ JSON. `.svelte` edits re-emit `render.js` (debounced) so the sidecar
picks them up without a V restart. `swelte dev` needs no plugin;
`SWELTE_PLUGINS=@swelte/ssr-qjs` adds `swelte ssr-check` (the CI gate, third-party plugin pattern).

## `swelte build [--root dir] [--output path] [--port N] [--target auto|static|node|edge] [--target-os linux|macos|windows] [--target-arch amd64|arm64] [--local]`

1. `generate()` into `.swelte/` (`routes/*.v` + `server_gen.v` +
   `.swelte/server.v` harness). Emits dev `.swelte/dev/<mod>.wasm` per file
   (mtime-guarded); the prod bundle compiles in `generateBundle`.
   Also writes `.swelte/entries.json` (prerender crawl list — static
   routes always, dynamics expanded from sibling `entries.ts` only when
   `prerender.entries: 'all'`).
2. `vite build` (wipes `dist/` first — never put the binary inside it
   before this step).
3. QJS bridge pass: adapter's `generateBundle` emits
   `routes/swelte_qjs_bridge.v` + `dist/ssr/render.js`; regenerate so
   `server_gen.v` compiles against it (core-only: idempotent, no bridge).
   Rebuild `libqjs.a` host-native, or `libqjs-<os>-<arch>.a` when cross
   (mtime-guarded, compiled under the zig-cc wrapper).
4. `v -o dist/server .swelte/server.v` (single artifact; QJS projects
   add `-enable-globals -cc <cc>`). Core-only builds link natively —
   generate() emits a no-op bridge stub (same symbol, returns not-ok,
   `SWELTE_SSR=1` falls through to the proxy at runtime); projects with
   plugin V modules (db backend) add `-enable-globals`.
   Cross-build: `--target-os <os> --target-arch <arch>` (CLI wins,
   `SWELTE_TARGET_OS`/`SWELTE_TARGET_ARCH` env middle,
   `swelte.targetOs`/`swelte.targetArch` config last — config also reads
   `<root>/package.json`'s `swelte` key as fallback) passes
   `-os <os> -arch <arch> -cc <zig-cc wrapper> -d use_bundled_libgc` to
   the link. Unknown CLI/env value = build error (`linux|macos|windows`
   × `amd64|arm64` only); unknown config value falls back to host-native.
   `vvm prepare` (auto-run by postinstall when a target is declared)
   downloads zig + writes the wrapper — `npm i` preps the machine.
   `--local` forces host-native, ignoring the package.json declaration
   (local preview on a machine whose package.json declares a deploy
   target); it cannot be combined with `--target-os/--target-arch`.
5. Prerender crawl (only when `prerender.entries` is `static`|`all`):
   boot the binary on an ephemeral port, GET each crawl URL, write
   additive `dist/<route>/index.html` (root `/` shell never
   overwritten). `isr` freezes to `SWELTE_ISR` for this env.
   Offline `fallback` file written best-effort from the first page.
   Cross-build: skipped (foreign binary can't boot).
6. Target shim (packaging only): `--target` wins, else `swelte.target`
   (`static` → `dist/.swelte-static`, `node` →
   `dist/Dockerfile.swelte`, `edge` → `dist/_headers`).
7. Artifacts only: assert `dist/server` + `dist/index.html` exist.
   No boot, no ports — build never listens (cross-built, sandboxed,
   or Windows binaries may not execute here; booting belongs to
   `swelte preview` / the preview e2e / `swelte ssr-check`).
   WASM is untouched by `--target-os/--target-arch` (always
   `-os browser`), and `dev`/`preview`/`test` stay host-native
   (the flags are build-only).

## `swelte test [--root dir] [--update-snapshot | -u]`

1. `generate()` (types must be fresh).
2. `v test` on every dir under `src/lib` + `src/routes` holding `.v`
   files (native, no browser — `*_test.v` files). The generated `.swelte`
   module root is added to V's lookup path so tests resolve npm V modules
   exactly like dev/build.
3. Contract check: every `.d.ts` fn must exist in its generated stub
   JS (types↔stubs parity), plus `tsc` over `types/`.
4. Shape snapshot: every `.d.ts` projection recorded in
   `<root>/swelte.contract.json` (**committed**, not gitignored —
   drift detection survives a fresh clone; `.swelte/` stays derived).
   Fail on drift; re-run with `--update-snapshot` after an intentional
   V type change to accept.

`SWELTE_CLIENT=1` additionally typechecks the client stubs (default:
server-only).

## `swelte deploy [init|status] [--target vercel|docker|fly|railway|render|static]` — NEW

Setup-only config automater (never ships): generates `Dockerfile[.vercel]` +
`.dockerignore` (+ `.vercelignore` / `fly.toml` / `railway.json` /
`render.yaml` per target; `static` writes `dist/.swelte-static`) + patches
`package.json:swelte.targetOs/targetArch → linux/amd64`. `status`
(`--format json` for agents) drift-checks without writes. Full contract:
[deploy.md](deploy.md).

## `swelte preview [--port N] [--root dir] [--binary path]`

Run the built V binary only (Vite-less prod run). Serves `dist/` +
API on one port. Auto-sets `SWELTE_SSR=1` when the QJS bridge artifact
exists (detection only — core never starts an engine).

## `swelte export [--root dir] [--out snapshot/]`

Snapshot the crawl (packaging only, reuses the build output — no new
enumeration): copies `.swelte/entries.json` + every additive
`dist/*.html` (as `pages/…`) + `swelte.contract.json` into
`<out>/` with a `snapshot.json` manifest (`{ target, pages,
at }`). Fails when `.swelte/entries.json` is missing (run `swelte
build` first).

## `swelte check [--root dir] [--format text|json] [--lib]`

`swelte check` diagnostics without side effects: same scans as
generate-time warns (`gen/diagnostics.ts`), file+line entries for
humans and `--format json` for agents. `--lib` additionally validates
the library schema (`docs/libraries.md`): `swelte.v.exports` rules
(shared validator with the consumer path), `exports`/`files` coverage,
and the no-`src/routes`-leak rule — all as `lib-*` warnings.

## `swelte package [--root dir] [--input dir] [--output dir] [--tsconfig file] [--no-types]`

Build the reusable `src/lib` surface of any Swelte project into `package/`.
Uses the configured `swelte.libDir` unless `--input` is given. Emits JS/Svelte
and declarations, leaves declared V sources raw for consumer compilation,
and excludes routes. Validates publication metadata before building; failures
exit nonzero. No routes or V toolchain are required. Application output stays
in `dist/`; package output must be separate from application/source/generated
directories. `--output` requires matching publication paths in `package.json`.
See `libraries.md`; `swelte check --lib` offers read-only diagnostics.

## `swelte init [<dir>] [options]` — DEPRECATED

Forwards to `@swelte/create` when installed; otherwise errors with the
install hint. Use **`npm create @swelte [<dir>]`** instead:

```
npm create @swelte [<dir>] [--sample | --empty | --lib] [--template empty|sample|lib] [--kind app|lib] [--ssr|--no-ssr] [--yes|-y|--no-interactive] [--root dir] [--dir name]
```

Scaffold one Swelte project shape (empty by default; `--sample` adds demo
routes). Every starter has `"build": "swelte build"` for the application and
`"package": "swelte package"` for reusable `src/lib` output. No app/library
kind question is asked. `--template lib` selects reusable V sample content;
`--lib` / `--kind lib` remain compatibility aliases, not package types.
Projects start private; configure public exports and remove `private: true`
when publishing. See `libraries.md` for publication metadata.
`src/app.ts` and `src/app.css` are optional setup files, auto-imported by
`.swelte/entry-main.ts`; routers are generated by `dev`/`build`.

SSR is opt-in (default: SPA-only): `--ssr` adds `@swelte/ssr-qjs`
(SSR via embedded QuickJS) and swaps the `swelte` import in
`vite.config.ts` from `@swelte/core/vite` to `@swelte/ssr-qjs`
(`--no-ssr` forces SPA without asking). The base template ships
conventional empty dirs: `src/lib/` + `assets/`, each with an explainer
`README.md` (isomorphic V lib vs `backend/` boundary; `swelte.images`
build inputs — never bundled, never copied to `dist/`; use Vite's
default `public/` for verbatim-served files). Interactive (TTY) runs a
`@clack/prompts` wizard: project directory (when `<dir>` omitted) →
sample confirm → SSR
confirm (default No — add it later any time with `npm install
@swelte/ssr-qjs` + the import swap). Non-interactive (piped stdin,
`CI=1`, `--yes`/`--no-interactive`) skips all prompts and uses flag
defaults (empty, SPA); Ctrl-C cancels cleanly.

## `swelte migrate [--root dir] [--db path]` (builtin)

Apply `db/migrations/*.sql` to the embedded SQLite file (`SWELTE_DB_PATH`
env, `--db` flag, else `data/app.db`). First run scaffolds
`src/lib/backend/db.v` (shared conn + KV helpers) +
`db/migrations/001_swelte_kv.sql`. Idempotent — re-runs apply only new
files (tracked in `_swelte_migrations`). No plugin needed (was
`@swelte/plus/db`, now deprecated — jobs + backend live in core).

