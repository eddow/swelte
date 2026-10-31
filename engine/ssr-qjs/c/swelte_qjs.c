// `swelte_qjs` C glue — see swelte_qjs.h for the contract.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "quickjs.h"
#include "swelte_qjs.h"

#define SWELTE_QJS_MAX_RUNTIMES 64

/* Bytecode cache: one compiled module per distinct bundle, shared by all
 * runtimes. The bundle is keyed by FNV-1a hash of its bytes + length, so a
 * redeploy (mtime change → new bytes) compiles once and the old entry is
 * replaced. Guarded budgets stay per-render: the cache only skips the
 * per-runtime *parse* (~2ms of the 3–12ms wall); each render still gets a
 * fresh JSContext, interrupt handler, and memory limit.
 * Single-threaded V (`--threads` aside): no lock. Node sidecars aside,
 * the V binary runs renders on one thread at a time here. */
#define SWELTE_QJS_MAX_CACHED 4

typedef struct {
    uint64_t hash;
    size_t len;
    uint8_t *bc;
    size_t bc_len;
} swelte_qjs_cached;

static swelte_qjs_cached swelte_qjs_cache_tbl[SWELTE_QJS_MAX_CACHED];
static int swelte_qjs_cache_next = 0;

static uint64_t swelte_qjs_hash(const char *s, int len) {
    /* FNV-1a 64: cheap, good enough for a cache key (collision → stale
     * render for one bundle version, not a crash; length is compared too). */
    uint64_t h = 14695981039346656037ull;
    for (int i = 0; i < len; i++) {
        h ^= (unsigned char)s[i];
        h *= 1099511628211ull;
    }
    return h;
}

static swelte_qjs_cached *swelte_qjs_cache_lookup(const char *s, int len) {
    uint64_t h = swelte_qjs_hash(s, len);
    for (int i = 0; i < SWELTE_QJS_MAX_CACHED; i++) {
        if (swelte_qjs_cache_tbl[i].bc && swelte_qjs_cache_tbl[i].hash == h &&
            swelte_qjs_cache_tbl[i].len == (size_t)len) {
            return &swelte_qjs_cache_tbl[i];
        }
    }
    return NULL;
}

static JSRuntime *swelte_qjs_rts[SWELTE_QJS_MAX_RUNTIMES];
static int swelte_qjs_rt_used[SWELTE_QJS_MAX_RUNTIMES];

int swelte_qjs_new_runtime(void) {
    for (int i = 0; i < SWELTE_QJS_MAX_RUNTIMES; i++) {
        if (!swelte_qjs_rt_used[i]) {
            JSRuntime *rt = JS_NewRuntime();
            if (!rt)
                return 0;
            swelte_qjs_rts[i] = rt;
            swelte_qjs_rt_used[i] = 1;
            return i + 1;
        }
    }
    return 0;
}

void swelte_qjs_free_runtime(int handle) {
    int i = handle - 1;
    if (i < 0 || i >= SWELTE_QJS_MAX_RUNTIMES || !swelte_qjs_rt_used[i])
        return;
    swelte_qjs_rt_used[i] = 0;
    JS_FreeRuntime(swelte_qjs_rts[i]);
    swelte_qjs_rts[i] = NULL;
}

typedef struct {
    uint64_t start_ms;
    int timeout_ms;
} swelte_qjs_budget;

static uint64_t swelte_qjs_now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

static int swelte_qjs_interrupt(JSRuntime *rt, void *opaque) {
    (void)rt;
    swelte_qjs_budget *b = (swelte_qjs_budget *)opaque;
    if (b->timeout_ms <= 0)
        return 0;
    return (int)(swelte_qjs_now_ms() - b->start_ms >= (uint64_t)b->timeout_ms);
}

typedef struct {
    const char *src;
    int len;
    const uint8_t *bc;
    size_t bc_len;
} swelte_qjs_mod;

static JSModuleDef *swelte_qjs_loader(JSContext *ctx, const char *name, void *opaque) {
    (void)name;
    swelte_qjs_mod *m = (swelte_qjs_mod *)opaque;
    if (m->bc && m->bc_len > 0) {
        /* Bytecode path: hand the UNLINKED module back to the linker.
         * The driver (`import ... from 'render.js'`) triggers resolve +
         * link + eval exactly once — the loader must NOT eval itself
         * (that double-links and trips `m->status == UNLINKED`). The
         * bundle is self-contained (Rollup IIFE→ESM, no further imports),
         * so returning the module is the whole job. */
        JSValue mod = JS_ReadObject(ctx, m->bc, m->bc_len, JS_READ_OBJ_BYTECODE);
        if (JS_IsException(mod))
            return NULL;
        JSModuleDef *md = JS_VALUE_GET_PTR(mod);
        JS_FreeValue(ctx, mod);
        return md;
    }
    JSValue mod = JS_Eval(ctx, m->src, (size_t)m->len, "render.js",
                           JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(mod))
        return NULL;
    JSModuleDef *md = JS_VALUE_GET_PTR(mod);
    JS_FreeValue(ctx, mod);
    return md;
}

/* Compile the source bundle to bytecode once (per distinct bytes) and pin
 * it in the cache table (ring of 4). Returns the cache entry, or NULL on
 * compile failure (caller falls back to the source path). A throwaway
 * runtime+context does the compile so the render runtime is untouched. */
static swelte_qjs_cached *swelte_qjs_ensure_bytecode(const char *src, int len) {
    swelte_qjs_cached *hit = swelte_qjs_cache_lookup(src, len);
    if (hit)
        return hit;
    JSRuntime *rt = JS_NewRuntime();
    if (!rt)
        return NULL;
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) {
        JS_FreeRuntime(rt);
        return NULL;
    }
    swelte_qjs_cached *slot = NULL;
    JSValue mod = JS_Eval(ctx, src, (size_t)len, "render.js",
                           JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(mod)) {
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return NULL;
    }
    size_t bc_len = 0;
    uint8_t *bc = JS_WriteObject(ctx, &bc_len, mod, JS_WRITE_OBJ_BYTECODE);
    JS_FreeValue(ctx, mod);
    if (!bc || bc_len == 0) {
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return NULL;
    }
    /* Malloc-copy BEFORE freeing the compile runtime: bc lives in the
     * runtime's allocator and dies with it. js_free_rt while rt is alive. */
    uint8_t *copy = (uint8_t *)malloc(bc_len ? bc_len : 1);
    if (!copy) {
        js_free_rt(rt, bc);
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return NULL;
    }
    memcpy(copy, bc, bc_len);
    js_free_rt(rt, bc);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    /* Ring-replace the oldest entry. */
    slot = &swelte_qjs_cache_tbl[swelte_qjs_cache_next];
    swelte_qjs_cache_next = (swelte_qjs_cache_next + 1) % SWELTE_QJS_MAX_CACHED;
    if (slot->bc)
        free(slot->bc);
    slot->hash = swelte_qjs_hash(src, len);
    slot->len = (size_t)len;
    slot->bc = copy;
    slot->bc_len = bc_len;
    return slot;
}

int swelte_qjs_render(int rt_handle, const char *mod_src, int mod_len,
                      const char *route, int route_len, const char *props,
                      int props_len, char *out_buf, int out_cap,
                      int timeout_ms, unsigned mem_cap_mb) {
    if (out_cap > 0 && out_buf)
        out_buf[0] = 0;
    int i = rt_handle - 1;
    if (i < 0 || i >= SWELTE_QJS_MAX_RUNTIMES || !swelte_qjs_rt_used[i])
        return -3;
    JSRuntime *rt = swelte_qjs_rts[i];
    if (!mod_src || mod_len <= 0 || !route || !props || !out_buf || out_cap <= 1)
        return -3;
    if (mem_cap_mb > 0)
        JS_SetMemoryLimit(rt, (size_t)mem_cap_mb * 1024u * 1024u);
    swelte_qjs_budget budget;
    budget.start_ms = swelte_qjs_now_ms();
    budget.timeout_ms = timeout_ms;
    if (timeout_ms > 0)
        JS_SetInterruptHandler(rt, swelte_qjs_interrupt, &budget);
    swelte_qjs_mod holder;
    holder.src = mod_src;
    holder.len = mod_len;
    holder.bc = NULL;
    holder.bc_len = 0;
    /* Prefer cached bytecode (compile once per bundle bytes, reuse across
     * renders); miss or compile failure → source path in the loader. */
    swelte_qjs_cached *cached = swelte_qjs_ensure_bytecode(mod_src, mod_len);
    if (cached && cached->bc && cached->bc_len > 0) {
        holder.bc = cached->bc;
        holder.bc_len = cached->bc_len;
    }
    JS_SetModuleLoaderFunc(rt, NULL, swelte_qjs_loader, &holder);
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx)
        return -3;
    int rc = -3;
    char rbuf[4096];
    char pbuf[65536];
    if (route_len >= (int)sizeof(rbuf) - 1 || props_len >= (int)sizeof(pbuf) - 1) {
        JS_FreeContext(ctx);
        if (timeout_ms > 0)
            JS_SetInterruptHandler(rt, NULL, NULL);
        return -3;
    }
    memcpy(rbuf, route, (size_t)route_len);
    rbuf[route_len] = 0;
    memcpy(pbuf, props, (size_t)props_len);
    pbuf[props_len] = 0;
    static const char drv[] = "import { renderRoute } from 'render.js'; globalThis.__rr = renderRoute;";
    JSValue v = JS_Eval(ctx, drv, sizeof(drv) - 1, "<swelte-drv>", JS_EVAL_TYPE_MODULE);
    if (JS_IsException(v))
        goto done;
    JS_FreeValue(ctx, v);
    JSValue g = JS_GetGlobalObject(ctx);
    JSValue fn = JS_GetPropertyStr(ctx, g, "__rr");
    if (JS_IsException(fn)) {
        JS_FreeValue(ctx, fn);
        JS_FreeValue(ctx, g);
        rc = -1;
        goto done;
    }
    if (!JS_IsFunction(ctx, fn)) {
        JS_FreeValue(ctx, fn);
        JS_FreeValue(ctx, g);
        rc = -2;
        goto done;
    }
    JSValue js_route = JS_NewString(ctx, rbuf);
    JSValue js_props = JS_NewString(ctx, pbuf);
    JSValue argv[2] = { js_route, js_props };
    JSValue ret = JS_Call(ctx, fn, g, 2, argv);
    JS_FreeValue(ctx, js_route);
    JS_FreeValue(ctx, js_props);
    JS_FreeValue(ctx, fn);
    JS_FreeValue(ctx, g);
    if (JS_IsException(ret)) {
        JS_FreeValue(ctx, ret);
        rc = -1;
        goto done;
    }
    JSValue body = JS_GetPropertyStr(ctx, ret, "body");
    if (JS_IsException(body)) {
        JS_FreeValue(ctx, body);
        JS_FreeValue(ctx, ret);
        rc = -1;
        goto done;
    }
    size_t blen = 0;
    const char *bs = JS_ToCStringLen(ctx, &blen, body);
    JS_FreeValue(ctx, body);
    JS_FreeValue(ctx, ret);
    if (!bs) {
        rc = -1;
        goto done;
    }
    if (blen == 0) {
        JS_FreeCString(ctx, bs);
        rc = -2;
        goto done;
    }
    {
        size_t copy = blen < (size_t)(out_cap - 1) ? blen : (size_t)(out_cap - 1);
        memcpy(out_buf, bs, copy);
        out_buf[copy] = 0;
        JS_FreeCString(ctx, bs);
        rc = (int)blen;
    }
done:
    JS_FreeContext(ctx);
    if (timeout_ms > 0)
        JS_SetInterruptHandler(rt, NULL, NULL);
    return rc;
}
