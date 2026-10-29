# Roadmap (not built)

Ordered. Each item is a delta from `docs/` (which describes what is
built: `.v` imports, codegen, envelope, example). Nothing here is
implemented; items leave this file when they land in `docs/`.
The `.v`-import design rationale lives in `v-imports.md` (§1–§5 built,
§6 open questions).

## 1. Generated V dispatcher

`generate()` already scans everything for types; extend it to emit
`.swelte/server.gen.v`. Per file: `@[rpc]` fns dispatch by `"fn"` in
the JSON body; verb handlers dispatch by (method, qualifier) —
default or `('q')` matched against `?q` (error cases: unknown `fn` →
404 + available, unknown qualifier → 404 + available qualifiers,
missing `"fn"` → 400, bad JSON → 400, `!T` → 400, method without
handler → 405). Shrink `server.v` to `Hand` + static + `main()`.
Includes: `Request` shape for verb handlers (query, form fields,
headers, cookies, route params), `time.Time` unix wire (decided),
form/multipart `?q` branch per file, one-default-per-verb validation
(two `@[post]` defaults = build error).

## 2. `swelte dev` orchestration

One command: free ports, spawn `v run server.v` + Vite with injected
`vBackendUrl`, restart V on `.v` change, kill both on Ctrl-C. Kills the
two-terminal dance. CLI shape (decided 2026-10-29): single `swelte` bin
for everything (`dev | build | preview | init | check`); logic lives in
`src/cli.ts` + `src/commands/*.ts` (TS, tsc-ed, sharing `src/`
internals), `bin/swelte.js` stays a ~5-line shim (npm needs a runnable
file before `tsc` runs). `bin/` is gitignored (regenerable).

## 3. `swelte build`

`v check` → `.swelte/` → `v -o .swelte/server` + `v -b wasm` (per `#lib`
file) → `vite build` → `dist/` + static-serving V binary. Binary lives
in `.swelte/` for dev, `dist/`-adjacent for prod — never the project root.

## 4. `swelte preview`

Run the built V binary only: serves `dist/` + API routes on one port.
No Vite involved (vite-less prod run).

## 5. `swelte init` / `create`

Scaffold: `vite.config.ts`, `svelte.config.js`, tsconfig wildcards
(`#routes/*.v` / `#lib/*.v` → `.swelte`), `.gitignore` for
`.swelte/` + `server` + `dist/`.

## 6. V-WASM real compile (`#lib/`, dual pipeline)

Dev: per-file micro-modules (`.swelte/dev/<mod>.wasm`), HMR-scoped
rebuilds. Prod: single bundle (`dist/assets/app_lib.wasm`) from a
generated entry importing all client-used `#lib/` files,
`v -b wasm -prod` (LTO + DCE, <100KB target). Bridge
(`__swelteWasmCall`) masks the difference; importers never change.
First: one real `v -b wasm` proving (string/struct over the JSON
boundary, `!T` surfacing, allowlist, size report). (Dev fallback
works; no artifact compiled yet.)

## 7. Layouts

`+layout.svelte` / `+layout.v` inheritance semantics (nested layouts,
data flow down).

## 8. Dynamic segments

`[id]`, `[...rest]` param flow into args structs.

## 9. Trailing-slash / 404 / `+error`

Conventions for slash handling, unknown-path 404 page, `+error` boundary.
SSR vs SPA fallback decision.

## 10. Auth/session

Cookies vs tokens, `Set-Cookie` on login, CSRF for `POST /`, CORS for
`/api/*`. (`#lib/` WASM has no network surface — server rules only.)

## 11. Hardening

Rate-limit, body size caps, timeouts.

## 12. No-JS form proof

Verb handlers are spec'd; prove end-to-end: no-JS `<form action="?q">`
→ `@[post('q')]` → redirect + error rendering without JS.

## 13. File uploads

`multipart` handling, large bodies.

## 14. Streaming (SSE/WS)

README-era promise; `rpc.md` is silent. Either spec as v2-defer or
define now: which fns stream, wire format, reconnect, backpressure.

## 15. Validation strictness

Orphan `routes/*.v`, leaf-vs-index clash, `.v` outside
`routes/`+`lib/`, `#lib/server` misuse, stray `@[get/post]` in `#lib/`,
duplicate verb defaults / duplicate qualifiers — all warn today (or
unimplemented), none fail. Decide warn-vs-error per case;
emit machine-readable list with file+line. Note: one-default-per-verb
and qualifier uniqueness MUST be errors at dispatcher time (ambiguous
routing), so this item is really about the rest.

## 16. `#lib/server` negative test

Guard is built (resolveId+load refuse with importer+file error);
unproven — needs a server-only fixture + import-guard test.

## 17. Relative `./x.v` editor types

Build works (`resolveId` handles relatives + alias-pre-resolved abs
paths); editors show the `*.v` fallback (`any`). Decide: `#`-only
(lint) or per-dir `paths` scoping.

## 18. `#lib/` stdlib allowlist as build error

Set decided (`strings`, `math`, `encoding/*`, `crypto/*`, `json`,
`json2`; `#lib/server/` exempt — see `v-imports.md` §2). Warns today;
enforce at build (error) once the V-WASM compile lands (§6).

## 19. Single-artifact deploy

`dist/` + binary as one deployable (V binary serves static + API;
no Node at runtime).

## 20. Testing story

`v test` for `.v` fns + TS-side contract tests against generated `.d.ts`.

## 21. HMR for `.v` signature changes

Regen already watches `.v` files; Svelte remount behavior on
signature change unproven.

## 22. Extra HTTP verbs (`put`/`delete`/`patch`)

Table, qualifier rules, `Request` shape, and dispatcher branches are
spec'd (`v-imports.md` §3); parser + codegen + dispatcher implement
`rpc`/`get`/`post` only. Add each verb on demand (explicit todo, not
a question): extend the attr regex, `__swelteFetch` kind, stub
codegen, and the dispatcher method arms.

## Background

The original ecosystem sketch is preserved in git history under
`plans/swelte_framework_ecosystem_architecture_spec.md`. Superseded
where it conflicts with `docs/`; kept as context for
packaging/examples only.
