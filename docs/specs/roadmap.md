# Roadmap (open items only)

Built work is recorded in git history + `docs/` user docs
(`../rpc.md`, `../types.md`, `../errors.md`, `../ssr.md`, `../example.md`).
Design rationale lives in `../internal/`. This file tracks open work only.

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
