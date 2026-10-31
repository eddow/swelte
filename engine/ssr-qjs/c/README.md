# `engine/ssr-qjs/c/` — vendored QuickJS + Swelte render glue

## Upstream

- **Version:** 2026-06-04 (`CONFIG_VERSION`), from
  https://bellard.org/quickjs/quickjs-2026-06-04.tar.xz
- **License:** MIT (Fabrice Bellard / Charlie Gordon) — see upstream
  `LICENSE` in the tarball. Vendored files carry their upstream headers.
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
| `quickjs-libc.h` | upstream header ONLY — `quickjs-libc.c` is deliberately NOT vendored (it carries `std`/`os` I/O: the render context must have no fs/net/process) |
| `libregexp.*`, `libunicode.*`, `cutils.*`, `dtoa.*`, `list.h`, `unicode_gen_def.h` | upstream support sources consumed via `#include` from `quickjs.c` |
| `swelte_qjs.c`, `swelte_qjs.h` | Swelte-owned C glue (render contract, guards) |

## Why vendored (not a submodule / system package)

The V binary links this C directly (`#flag` on the prebuilt `libqjs.a`,
see `src/qjs.ts`). A vendored copy keeps the prod build hermetic — no
apt/npm step, no network at `swelte build` time, exact-version pinned.
`qjs`/`qjsc` dev binaries are NOT vendored (build them from the same
tarball when needed: `make qjs qjsc`).

## Build

`src/qjs.ts` (`buildQjsLib`) compiles each `.c` with gcc
(`-O2 -D_GNU_SOURCE -DCONFIG_VERSION="2026-06-04" -fwrapv -fPIC`)
and archives them + `swelte_qjs.o` into `libqjs.a`. V's bundled tcc
cannot compile `quickjs.c`, hence the prebuilt archive (V links one
`.a` per `#flag` — multiple `.o` files are not accepted).
