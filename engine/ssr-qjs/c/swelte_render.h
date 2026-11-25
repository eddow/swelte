#include "quickjs.h"
#include "swelte_qjs.h"
// `swelte_render` — SSR render C glue between V and vendored QuickJS.
//
// Engine primitives (runtime handles, budget clock/interrupt) are declared
// by `swelte_qjs.h` and defined by the shared engine archive
// (`@swelte/qjs`); this header only declares the render entries, which the
// SSR consumer compiles into its own archive and links after the engine.
//
// OWNERSHIP (V 0.5.2 autofree): V frees the *slot* of every &char/voidptr
// local at scope end — double-freeing any C-owned (malloc'd) pointer it
// aliases. The glue therefore NEVER returns malloc'd pointers: the caller
// passes a fixed V-side buffer + length, C copies the output in and
// reports the needed length. `out==0` means empty; negative means failure.
//
// WIDTH (V 0.5.2 codegen): u64 C args/returns arrive truncated to 32 bits.
// Handles and sizes cross as `int` (bundles are KBs — no >2GB render).
//
// Render contract:
//   swelte_qjs_render(handle, mod_src, mod_len, route, route_len,
//                     props, props_len, out_buf, out_cap, ...) -> needed
//   - fresh JSContext per call; runtime is per-render via the opaque int
//     handle (created by swelte_qjs_new_runtime, freed by
//     swelte_qjs_free_runtime — V must NOT free it with C.free()).
//   - `mod_src` is the `dist/ssr/render.js` bundle (module code, sync).
//   - calls `renderRoute(route, props_json)` from the module namespace.
//   - copies `body` HTML into `out_buf` (truncated to `out_cap-1` + NUL);
//     returns the FULL needed length. V compares: needed <= out_cap-1
//     means complete, else grow + retry — or serve the SPA fallback.
//   - returns -1 (JS exception), -5 (timeout), -6 (memory exhaustion), -2 (no renderRoute
//     export), -3 (load/compile failure). Any failure → V falls back to
//     SPA shell / +error — never blank.
//   swelte_qjs_render_head_body(...) is the same call but ALSO copies
//   the `head` string (`<svelte:head>` output: title/meta/link) into a
//   second caller buffer with its own needed-length return. One JS call
//   serves both (no double render, one interrupt budget). Negative
//   returns mirror the single-buffer codes; head_len_out/body_len_out
//   carry the FULL needed lengths (each excluding NUL). `head == ''`
//   (no <svelte:head> on the page) completes with head_len 0 — NOT a
//   failure. -4 means empty body (rendered, nothing inside).
//
// Guards (enforced here, not in JS):
//   - interrupt handler: wall-clock budget in ms (0 = none; prod ~50).
//     On fire the eval aborts → -5 → V serves the SPA fallback or strict 500.
//   - memory cap in MB (0 = none; prod 16). Exhaustion returns -6.
//   - no `fs`/`net`/`process` shims are ever registered — the context has
//     no I/O globals at all. The QJS-compat build guard (`assertQjsCompatible`
//     in ssr.ts) rejects `node:`/`fetch`/top-level-await at bundle time;
//     this glue is the runtime backstop, not the policy.
#ifndef SWELTE_RENDER_H
#define SWELTE_RENDER_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct JSRuntime JSRuntime;

// Opaque runtime handle (int — V truncates u64 C values to 32 bits).
// 0 = allocation failure. Free exactly once via swelte_qjs_free_runtime
// (engine-owned; declared in `swelte_qjs.h`, defined in the engine archive).
int swelte_qjs_new_runtime(void);
void swelte_qjs_free_runtime(int handle);

// Engine-context lookup (defined by the shared engine): return the runtime
// for a live handle, or NULL. The render glue never blocks on JS.
JSRuntime *swelte_qjs_rt_at(int handle);

// Render into the caller buffer. Returns needed length (>=0, excl. NUL),
// or negative on failure (-1 js, -5 timeout, -6 memory, -2 no export, -3 load,
// -4 empty body: rendered, nothing inside — caller keeps the SPA shell).
// `out_buf` always NUL-terminated when out_cap > 0 (possibly truncated).
// NOTE: body-only legacy. Prefer swelte_qjs_render_head_body (single JS
// call, both strings); this stays for source-compat.
int swelte_qjs_render(int rt_handle, const char *mod_src, int mod_len,
                      const char *route, int route_len, const char *props,
                      int props_len, char *out_buf, int out_cap,
                      int timeout_ms, unsigned mem_cap_mb);

// Render body AND head in one JS call. `head_buf`/`head_cap` and
// `body_buf`/`body_cap` are independent caller buffers (each NUL-terminated
// when cap > 0, possibly truncated); `head_len_out`/`body_len_out` receive
// the FULL needed lengths. Return 0 on success (check the lens), negative
// on failure (-1/-2/-3/-4, same codes as swelte_qjs_render).
int swelte_qjs_render_head_body(int rt_handle, const char *mod_src, int mod_len,
                                const char *route, int route_len, const char *props,
                                int props_len, char *head_buf, int head_cap,
                                int *head_len_out, char *body_buf, int body_cap,
                                int *body_len_out, int timeout_ms, unsigned mem_cap_mb);

// Same render, with a private caller-owned diagnostic buffer. Contains the
// original JS exception/stack (or a caught render error), never HTML. At most
// diagnostic_cap-1 bytes, NUL terminated; cleared on every invocation. The
// caller decides whether to forward it to server-only reporting. No global
// error slot: concurrent requests cannot consume each other's diagnostics.
int swelte_qjs_render_report(int rt_handle, const char *mod_src, int mod_len,
                            const char *route, int route_len, const char *props,
                            int props_len, char *head_buf, int head_cap,
                            int *head_len_out, char *body_buf, int body_cap,
                            int *body_len_out, int timeout_ms, unsigned mem_cap_mb,
                            char *diagnostic_buf, int diagnostic_cap);

#ifdef __cplusplus
}
#endif

#endif
