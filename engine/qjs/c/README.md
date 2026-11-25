# `engine/qjs/` — shared embedded-QuickJS engine primitives + archive builder

## Upstream

- **Version:** 2026-06-04 (`CONFIG_VERSION`), from
  https://bellard.org/quickjs/quickjs-2026-06-04.tar.xz
- **License:** MIT (Fabrice Bellard / Charlie Gordon) — see upstream
  `LICENSE` in the tarball. Vendored files carry their upstream headers.
  `swelte_qjs.*` additionally uses `js_free_rt` (declared in
  `quickjs.h:417`, the runtime-allocator free) for bytecode copies that
  outlive the compile runtime — same allocator family, not a private API.
- **Upgrade:** re-download the tarball, copy the same file list below,
  rebuild. The glue (`swelte_qjs.*`) depends only on the public
  `quickjs.h` API (`JS_Eval`, `JS_EvalFunction` path via the module
  loader, `JS_Call`, `JS_SetInterruptHandler`, `JS_SetMemoryLimit`,
  `JS_*CString`, `JS_FreeContext`).

## Files

| File | Origin |
| --- | --- |
| `quickjs.c`, `quickjs.h` | upstream engine + public API |
| `quickjs-atom.h`, `quickjs-opcode.h` | upstream (included by `quickjs.c`) |
| `quickjs-libc.h` | upstream header ONLY — `quickjs-libc.c` is deliberately NOT vendored (it carries `std`/`os` I/O: the render AND agent contexts must have no fs/net/process) |
| `libregexp.*`, `libunicode.*`, `cutils.*`, `dtoa.*`, `list.h`, `unicode_gen_def.h` | upstream support sources consumed via `#include` from `quickjs.c` |
| `swelte_qjs.c`, `swelte_qjs.h` | engine-owned C glue: runtime/context lifecycle, evaluation budgets, interrupt clock, job-pump plumbing (no render/agent policy) |
| consumer glue | lives with its owner, NOT here: SSR render driver in `@swelte/ssr-qjs` (`engine/ssr-qjs/c/swelte_render.*`), agent eval in `@swelte/ai` (`engine/ai/c/swelte_agent.*`) |

## Why vendored (not a submodule / system package)

The V binary links this C directly (`#flag` on the prebuilt `libqjs.a`,
see `@swelte/qjs` `src/qjs.ts`). A vendored copy keeps the prod build hermetic — no
apt/npm step, no network at `swelte build` time, exact-version pinned.
`qjs`/`qjsc` dev binaries are NOT vendored (build them from the same
tarball when needed: `make qjs qjsc`).

## Build

The owning consumer's TS (`@swelte/qjs` `src/qjs.ts` → `dist/qjs.js`, consumed via
`buildQjsLib`) compiles each `.c` with gcc
(`-O2 -D_GNU_SOURCE -DCONFIG_VERSION="2026-06-04" -fwrapv -fPIC`)
and archives them + the glue objects into the shared
`.swelte/qjs/libqjs.a` (mtime-guarded — the second consumer no-ops).
V's bundled tcc cannot compile `quickjs.c`, hence the prebuilt archive
(V links one `.a` per `#flag` — multiple `.o` files are not accepted).
