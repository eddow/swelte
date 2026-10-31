// `swelte_qjs` C glue — see swelte_qjs.h for the contract.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <pthread.h>

#include "quickjs.h"
#include "swelte_qjs.h"

#define SWELTE_QJS_MAX_RUNTIMES 64

/* Bytecode cache: one compiled module per distinct bundle, shared by all
 * runtimes. The bundle is keyed by FNV-1a hash + length + full byte compare
 * on hit (hash collision would otherwise serve a stale bundle), so a
 * redeploy (mtime change → new bytes) compiles once and the old entry is
 * replaced. Guarded budgets stay per-render: the cache only skips the
 * per-runtime *parse* (~2ms of the 3–12ms wall); each render still gets a
 * fresh JSContext, interrupt handler, and memory limit.
 * V's veb serves requests on a thread pool, so the table, its ring cursor,
 * and the runtime handle table are guarded by a mutex. Bytecode blobs are
 * immutable once published; the loader only reads under the same mutex. */
#define SWELTE_QJS_MAX_CACHED 4

static pthread_mutex_t swelte_qjs_mu = PTHREAD_MUTEX_INITIALIZER;

typedef struct {
    uint64_t hash;
    size_t len;
    char *src;
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

static swelte_qjs_cached *swelte_qjs_cache_lookup_locked(const char *s, int len) {
    uint64_t h = swelte_qjs_hash(s, (size_t)len);
    for (int i = 0; i < SWELTE_QJS_MAX_CACHED; i++) {
        if (swelte_qjs_cache_tbl[i].bc && swelte_qjs_cache_tbl[i].hash == h &&
            swelte_qjs_cache_tbl[i].len == (size_t)len &&
            memcmp(swelte_qjs_cache_tbl[i].src, s, (size_t)len) == 0) {
            return &swelte_qjs_cache_tbl[i];
        }
    }
    return NULL;
}

static JSRuntime *swelte_qjs_rts[SWELTE_QJS_MAX_RUNTIMES];
static int swelte_qjs_rt_used[SWELTE_QJS_MAX_RUNTIMES];

int swelte_qjs_new_runtime(void) {
    pthread_mutex_lock(&swelte_qjs_mu);
    for (int i = 0; i < SWELTE_QJS_MAX_RUNTIMES; i++) {
        if (!swelte_qjs_rt_used[i]) {
            JSRuntime *rt = JS_NewRuntime();
            if (!rt) {
                pthread_mutex_unlock(&swelte_qjs_mu);
                return 0;
            }
            swelte_qjs_rts[i] = rt;
            swelte_qjs_rt_used[i] = 1;
            pthread_mutex_unlock(&swelte_qjs_mu);
            return i + 1;
        }
    }
    pthread_mutex_unlock(&swelte_qjs_mu);
    return 0;
}

void swelte_qjs_free_runtime(int handle) {
    pthread_mutex_lock(&swelte_qjs_mu);
    int i = handle - 1;
    if (i < 0 || i >= SWELTE_QJS_MAX_RUNTIMES || !swelte_qjs_rt_used[i]) {
        pthread_mutex_unlock(&swelte_qjs_mu);
        return;
    }
    swelte_qjs_rt_used[i] = 0;
    JSRuntime *rt = swelte_qjs_rts[i];
    swelte_qjs_rts[i] = NULL;
    pthread_mutex_unlock(&swelte_qjs_mu);
    JS_FreeRuntime(rt);
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
 * runtime+context does the compile so the render runtime is untouched.
 * Thread-safe: hit check + publish under the mutex; the compile itself
 * runs unlocked. A second thread racing the same bundle dedupes on
 * publish (lookup before insert); the loser's copy is freed. */
static swelte_qjs_cached *swelte_qjs_ensure_bytecode(const char *src, int len) {
    pthread_mutex_lock(&swelte_qjs_mu);
    swelte_qjs_cached *hit = swelte_qjs_cache_lookup_locked(src, len);
    pthread_mutex_unlock(&swelte_qjs_mu);
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
    char *srccopy = (char *)malloc((size_t)len ? (size_t)len : 1);
    if (!copy || !srccopy) {
        free(copy);
        free(srccopy);
        js_free_rt(rt, bc);
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return NULL;
    }
    memcpy(copy, bc, bc_len);
    memcpy(srccopy, src, (size_t)len);
    js_free_rt(rt, bc);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    /* Publish under the lock; dedupe a racy twin insert. */
    pthread_mutex_lock(&swelte_qjs_mu);
    hit = swelte_qjs_cache_lookup_locked(srccopy, len);
    if (hit) {
        pthread_mutex_unlock(&swelte_qjs_mu);
        free(copy);
        free(srccopy);
        return hit;
    }
    swelte_qjs_cached *slot = &swelte_qjs_cache_tbl[swelte_qjs_cache_next];
    swelte_qjs_cache_next = (swelte_qjs_cache_next + 1) % SWELTE_QJS_MAX_CACHED;
    free(slot->src);
    free(slot->bc);
    slot->hash = swelte_qjs_hash(srccopy, len);
    slot->len = (size_t)len;
    slot->src = srccopy;
    slot->bc = copy;
    slot->bc_len = bc_len;
    pthread_mutex_unlock(&swelte_qjs_mu);
    return slot;
}

int swelte_qjs_render(int rt_handle, const char *mod_src, int mod_len,
                      const char *route, int route_len, const char *props,
                      int props_len, char *out_buf, int out_cap,
                      int timeout_ms, unsigned mem_cap_mb) {
    if (out_cap > 0 && out_buf)
        out_buf[0] = 0;
    pthread_mutex_lock(&swelte_qjs_mu);
    int i = rt_handle - 1;
    int valid = (i >= 0 && i < SWELTE_QJS_MAX_RUNTIMES && swelte_qjs_rt_used[i]);
    JSRuntime *rt = valid ? swelte_qjs_rts[i] : NULL;
    pthread_mutex_unlock(&swelte_qjs_mu);
    if (!valid || !rt)
        return -3;
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
    /* Snapshot the cached bytecode pointer under the lock: the ring may
     * evict this entry while we compile the driver on our own runtime.
     * Refcount by malloc-copy (small, ~bytes of the bundle's compiled
     * form is KBs, not the source) so the entry can rotate freely. */
    const uint8_t *use_bc = NULL;
    size_t use_bc_len = 0;
    uint8_t *bc_snap = NULL;
    swelte_qjs_cached *cached = swelte_qjs_ensure_bytecode(mod_src, mod_len);
    pthread_mutex_lock(&swelte_qjs_mu);
    if (cached && cached->bc && cached->bc_len > 0) {
        bc_snap = (uint8_t *)malloc(cached->bc_len ? cached->bc_len : 1);
        if (bc_snap) {
            memcpy(bc_snap, cached->bc, cached->bc_len);
            use_bc = bc_snap;
            use_bc_len = cached->bc_len;
        }
    }
    pthread_mutex_unlock(&swelte_qjs_mu);
    holder.bc = use_bc;
    holder.bc_len = use_bc_len;
    JS_SetModuleLoaderFunc(rt, NULL, swelte_qjs_loader, &holder);
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) {
        free(bc_snap);
        return -3;
    }
    int rc = -3;
    char rbuf[4096];
    /* Route/props cross as length-delimited C strings; allocate by length
     * (props routinely exceed the old 64KB stack slot on data-heavy
     * @[load] pages). Oversize-but-sane inputs render; absurd ones (>1MB
     * props) fall back to SPA with -3 rather than OOMing the render. */
    char *rdup = NULL;
    char *pdup = NULL;
    if (route_len < 0 || props_len < 0 || route_len >= 65536 || props_len >= 1024 * 1024) {
        free(bc_snap);
        JS_FreeContext(ctx);
        if (timeout_ms > 0)
            JS_SetInterruptHandler(rt, NULL, NULL);
        return -3;
    }
    rdup = (char *)malloc((size_t)route_len + 1);
    pdup = (char *)malloc((size_t)props_len + 1);
    if (!rdup || !pdup) {
        free(rdup);
        free(pdup);
        free(bc_snap);
        JS_FreeContext(ctx);
        if (timeout_ms > 0)
            JS_SetInterruptHandler(rt, NULL, NULL);
        return -3;
    }
    memcpy(rdup, route, (size_t)route_len);
    rdup[route_len] = 0;
    memcpy(pdup, props, (size_t)props_len);
    pdup[props_len] = 0;
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
    JSValue js_route = JS_NewString(ctx, rdup);
    JSValue js_props = JS_NewString(ctx, pdup);
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
        /* Empty body ≠ missing export: <0 would force a +error render.
         * -4 tells the V caller "rendered, nothing inside" so it keeps
         * the static SPA shell instead of escalating to +error. */
        rc = -4;
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
    free(rdup);
    free(pdup);
    free(bc_snap);
    JS_FreeContext(ctx);
    if (timeout_ms > 0)
        JS_SetInterruptHandler(rt, NULL, NULL);
    return rc;
}
