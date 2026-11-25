// `swelte_agent` C glue — see swelte_agent.h for the contract.
//
// The runtime-handle table, budget clock and diagnostic discipline live in
// the shared engine (`@swelte/qjs` `swelte_qjs.c`, its own archive and
// mutex). This file is the AI consumer's own archive: agent programs are
// async (top-level await allowed); bindings arrive as a V-owned JSON table;
// the V host — not C — authorizes every native call. No I/O globals are
// ever registered: bindings are the only bridge to the native side.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <pthread.h>

#include "quickjs.h"
#include "swelte_agent.h"
#include "swelte_qjs.h"

typedef struct {
    int calls;
    int max_calls;
} swelte_agent_host;

static void swelte_agent_copy_diagnostic(JSContext *ctx, JSValueConst value,
                                         char *buf, int cap) {
    if (!buf || cap < 2 || JS_IsUndefined(value) || JS_IsNull(value)) return;
    JSValue stack = JS_IsObject(value) ? JS_GetPropertyStr(ctx, value, "stack") : JS_UNDEFINED;
    size_t len = 0;
    const char *text = JS_ToCStringLen(ctx, &len, value);
    size_t count = 0;
    if (text) {
        count = len < (size_t)(cap - 1) ? len : (size_t)(cap - 1);
        while (count < len && count > 0 && ((unsigned char)text[count] & 0xc0) == 0x80) count--;
        memcpy(buf, text, count);
        buf[count] = 0;
        JS_FreeCString(ctx, text);
    }
    if (count < (size_t)(cap - 2) && !JS_IsException(stack) && !JS_IsUndefined(stack)) {
        text = JS_ToCStringLen(ctx, &len, stack);
        if (text) {
            buf[count++] = '\n';
            size_t remaining = (size_t)(cap - 1) - count;
            size_t extra = len < remaining ? len : remaining;
            while (extra < len && extra > 0 && ((unsigned char)text[extra] & 0xc0) == 0x80) extra--;
            memcpy(buf + count, text, extra);
            buf[count + extra] = 0;
            JS_FreeCString(ctx, text);
        }
    }
    JS_FreeValue(ctx, stack);
}

// Map a JS failure to a return code: -6 when the engine reports
// out-of-memory (mirrors the render glue), -5 on interruption, else -1.
static int swelte_agent_fail_code(JSContext *ctx, JSValueConst err,
                                  swelte_qjs_budget *budget) {
    if (budget->interrupted)
        return -5;
    int rc = -1;
    size_t len = 0;
    const char *text = JS_ToCStringLen(ctx, &len, err);
    if (text) {
        if (strstr(text, "out of memory"))
            rc = -6;
        JS_FreeCString(ctx, text);
    }
    return rc;
}

// Binding table: parsed from V-owned `bindings_json`. C keeps only names +
// count; arg schemas and side-effect flags stay on the V side, which
// validates every call before it runs.
#define SWELTE_AGENT_MAX_BINDINGS 64
#define SWELTE_AGENT_MAX_NAME 128

typedef struct {
    char names[SWELTE_AGENT_MAX_BINDINGS][SWELTE_AGENT_MAX_NAME];
    int count;
} swelte_agent_bindings;

// Minimal `"name"` scanner: the V host owns the schema; C needs callables.
static int swelte_agent_scan_name(const char *json, int json_len, int *pos,
                                  char *out, int out_cap) {
    static const char key[] = "\"name\"";
    int i = *pos;
    while (i + 6 <= json_len) {
        if (memcmp(json + i, key, 6) == 0) {
            i += 6;
            while (i < json_len && (json[i] == ' ' || json[i] == '\t' ||
                                    json[i] == '\n' || json[i] == '\r' || json[i] == ':'))
                i++;
            if (i < json_len && json[i] == '"') {
                i++;
                int n = 0;
                while (i < json_len && json[i] != '"' && n < out_cap - 1) {
                    if (json[i] == '\\' && i + 1 < json_len) {
                        i++;
                        out[n++] = json[i++];
                    } else {
                        out[n++] = json[i++];
                    }
                }
                out[n] = 0;
                if (n == 0)
                    return -1;
                *pos = i;
                return 0;
            }
            return -1;
        }
        i++;
    }
    return 1;
}

static int swelte_agent_parse_bindings(const char *json, int json_len,
                                       swelte_agent_bindings *out) {
    out->count = 0;
    if (!json || json_len <= 0)
        return 0;
    int pos = 0;
    while (out->count < SWELTE_AGENT_MAX_BINDINGS) {
        char name[SWELTE_AGENT_MAX_NAME];
        int rc = swelte_agent_scan_name(json, json_len, &pos, name, sizeof(name));
        if (rc == 1)
            break;
        if (rc != 0)
            return -3;
        for (int k = 0; k < out->count; k++) {
            if (strcmp(out->names[k], name) == 0)
                return -3;
        }
        memcpy(out->names[out->count], name, sizeof(name));
        out->count++;
        pos++;
    }
    return 0;
}

// One binding call: JS `name(args)` → host queue record. The host boundary
// is synchronous by contract (no threads cross it): C counts the call and
// returns a rejected promise with the stub reason until the V dispatcher
// entry lands — the native side effect never runs. Resolved args are still
// serialized (proves the validation input exists) and JSON-unserializable
// args fail closed with TypeError. The binding index travels as the
// C-function `magic` (set at registration); the per-eval registry lives in
// the context opaque pointer for the duration of the eval.

// Each context owns a borrowed registry for the duration of its evaluation.
typedef struct {
    swelte_agent_bindings *bindings;
    swelte_agent_host *host;
} swelte_agent_registry;


static JSValue swelte_agent_call(JSContext *ctx, JSValueConst this_val, int argc,
                                 JSValueConst *argv, int magic, JSValue *func_data) {
    (void)this_val;
    (void)argc;
    int index = magic;
    swelte_agent_registry *registry = JS_GetContextOpaque(ctx);
    if (!registry)
        return JS_ThrowInternalError(ctx, "agent: host unavailable");
    swelte_agent_registry reg = *registry;
    if (!reg.bindings || !reg.host)
        return JS_ThrowInternalError(ctx, "agent: host unavailable");
    if (index < 0 || index >= reg.bindings->count)
        return JS_ThrowReferenceError(ctx, "agent: unknown binding");
    if (reg.host->max_calls > 0 && reg.host->calls >= reg.host->max_calls)
        return JS_ThrowRangeError(ctx, "agent: binding call budget exhausted");
    reg.host->calls++;
    const char *args_json = "{}";
    char *owned = NULL;
    if (argc > 0 && !JS_IsUndefined(argv[0])) {
        JSValue ser = JS_JSONStringify(ctx, argv[0], JS_UNDEFINED, JS_UNDEFINED);
        if (!JS_IsException(ser)) {
            size_t alen = 0;
            const char *astr = JS_ToCStringLen(ctx, &alen, ser);
            if (astr) {
                owned = (char *)malloc(alen + 1);
                if (owned) {
                    memcpy(owned, astr, alen);
                    owned[alen] = 0;
                    args_json = owned;
                }
                JS_FreeCString(ctx, astr);
            }
        }
        JS_FreeValue(ctx, ser);
        if (JS_HasException(ctx)) {
            free(owned);
            return JS_ThrowTypeError(ctx, "agent: binding args must be JSON-serializable");
        }
    }
    size_t msg_cap = strlen(reg.bindings->names[index]) + strlen(args_json) + 96;
    char *msg = (char *)malloc(msg_cap);
    if (msg) {
        snprintf(msg, msg_cap,
                 "agent: binding '%s' needs the V host dispatcher (not yet wired) — args %.200s",
                 reg.bindings->names[index], args_json);
    }
    free(owned);
    (void)func_data;
    JSValue err = msg ? JS_ThrowInternalError(ctx, "%s", msg)
                      : JS_ThrowInternalError(ctx, "agent: host dispatcher unavailable");
    free(msg);
    return err;
}

// Register one JS function per binding name on the global object. The
// binding index travels as the C-function `magic`; the per-eval registry
// (bindings + host counters) is claimed in the static slot before the
// context is created and released after it is freed.
//
// QuickJS ownership: `JS_SetPropertyStr` CONSUMES the value (do not free
// after a successful set); `JS_FreeValue(ctx, global)` still required.
static int swelte_agent_register_bindings(JSContext *ctx, swelte_agent_bindings *b) {
    JSValue global = JS_GetGlobalObject(ctx);
    int rc = 0;
    for (int i = 0; i < b->count; i++) {
        JSValue fn = JS_NewCFunctionData(ctx, swelte_agent_call, 1, i, 0, NULL);
        if (JS_IsException(fn)) {
            rc = -1;
            break;
        }
        if (JS_SetPropertyStr(ctx, global, b->names[i], fn) < 0) {
            JS_FreeValue(ctx, fn);
            rc = -1;
            break;
        }
    }
    JS_FreeValue(ctx, global);
    return rc;
}

// Eval entry: wrap the program as an async IIFE (top-level await allowed),
// eval, pump the job queue until it settles, serialize the completion value
// to JSON. Mirrors the render glue's ownership + interrupt + memory rules.
int swelte_agent_eval(int rt_handle, const char *src, int src_len,
                      const char *bindings_json, int bindings_len,
                      char *out_buf, int out_cap, int *result_len_out,
                      int timeout_ms, unsigned mem_cap_mb, int max_calls,
                      int max_result_b, char *diagnostic_buf,
                      int diagnostic_cap) {
    if (result_len_out)
        *result_len_out = 0;
    if (diagnostic_buf && diagnostic_cap > 0)
        diagnostic_buf[0] = 0;
    if (out_cap > 0 && out_buf)
        out_buf[0] = 0;
    JSRuntime *rt = swelte_qjs_rt_at(rt_handle);
    if (!rt)
        return -3;
    if (!src || src_len <= 0 || src_len > 1024 * 1024)
        return -3;
    if (!out_buf || out_cap <= 1)
        return -3;
    if (mem_cap_mb > 0)
        JS_SetMemoryLimit(rt, (size_t)mem_cap_mb * 1024u * 1024u);
    swelte_qjs_budget budget;
    budget.start_ms = swelte_qjs_now_ms();
    budget.timeout_ms = timeout_ms;
    budget.interrupted = 0;
    if (timeout_ms > 0)
        JS_SetInterruptHandler(rt, swelte_qjs_interrupt, &budget);
    swelte_agent_bindings bindings;
    int brc = swelte_agent_parse_bindings(bindings_json, bindings_len, &bindings);
    if (brc != 0) {
        if (timeout_ms > 0)
            JS_SetInterruptHandler(rt, NULL, NULL);
        return brc;
    }
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) {
        if (timeout_ms > 0)
            JS_SetInterruptHandler(rt, NULL, NULL);
        return -6;
    }
    swelte_agent_host host;
    host.calls = 0;
    host.max_calls = max_calls;
    // The stack registry remains valid until this context is freed.
    swelte_agent_registry claimed = { &bindings, &host };
    JS_SetContextOpaque(ctx, &claimed);
    int rc = -3;
    int reg = swelte_agent_register_bindings(ctx, &bindings);
    if (reg != 0) {
        rc = reg;
        goto done;
    }
    static const char pre[] = "(async () => {";
    static const char post[] = "\n})()";
    int wrapped_len = (int)sizeof(pre) - 1 + src_len + (int)sizeof(post) - 1;
    char *wrapped = (char *)malloc((size_t)wrapped_len + 1);
    if (!wrapped) {
        rc = -6;
        goto done;
    }
    memcpy(wrapped, pre, sizeof(pre) - 1);
    memcpy(wrapped + sizeof(pre) - 1, src, (size_t)src_len);
    memcpy(wrapped + sizeof(pre) - 1 + src_len, post, sizeof(post) - 1);
    wrapped[wrapped_len] = 0;
    JSValue promise = JS_Eval(ctx, wrapped, (size_t)wrapped_len, "<swelte-agent>",
                              JS_EVAL_TYPE_GLOBAL);
    free(wrapped);
    if (JS_IsException(promise)) {
        // Compile error: the return is the JS_EXCEPTION sentinel, not the
        // error object — fetch it via JS_GetException (same as the render
        // glue's `done:` path).
        JSValue exc = JS_GetException(ctx);
        swelte_agent_copy_diagnostic(ctx, exc, diagnostic_buf, diagnostic_cap);
        rc = swelte_agent_fail_code(ctx, exc, &budget);
        JS_FreeValue(ctx, exc);
        JS_FreeValue(ctx, promise);
        goto done;
    }
    for (;;) {
        JSContext *pctx = NULL;
        int pending = JS_ExecutePendingJob(JS_GetRuntime(ctx), &pctx);
        if (pending < 0) {
            JSValue exc = JS_GetException(ctx);
            swelte_agent_copy_diagnostic(ctx, exc, diagnostic_buf, diagnostic_cap);
            rc = swelte_agent_fail_code(ctx, exc, &budget);
            JS_FreeValue(ctx, exc);
            JS_FreeValue(ctx, promise);
            goto done;
        }
        if (pending == 0)
            break;
        if (budget.timeout_ms > 0 &&
            swelte_qjs_now_ms() - budget.start_ms >= (uint64_t)budget.timeout_ms) {
            budget.interrupted = 1;
            JS_FreeValue(ctx, promise);
            rc = -5;
            goto done;
        }
    }
    if (JS_IsException(promise)) {
        JSValue exc = JS_GetException(ctx);
        swelte_agent_copy_diagnostic(ctx, exc, diagnostic_buf, diagnostic_cap);
        rc = swelte_agent_fail_code(ctx, exc, &budget);
        JS_FreeValue(ctx, exc);
        JS_FreeValue(ctx, promise);
        goto done;
    }
    {
        JSValue result = promise;
        if (JS_IsObject(result)) {
            JSPromiseStateEnum state = JS_PromiseState(ctx, result);
            if (state == JS_PROMISE_PENDING) {
                JS_FreeValue(ctx, result);
                rc = -5;
                goto done;
            }
            if (state == JS_PROMISE_REJECTED) {
                JSValue reason = JS_PromiseResult(ctx, result);
                swelte_agent_copy_diagnostic(ctx, reason, diagnostic_buf, diagnostic_cap);
                rc = swelte_agent_fail_code(ctx, reason, &budget);
                JS_FreeValue(ctx, reason);
                JS_FreeValue(ctx, result);
                goto done;
            }
            JSValue value = JS_PromiseResult(ctx, result);
            JS_FreeValue(ctx, result);
            result = value;
        }
        // Bare expression statements under the async-function wrap complete
        // as `undefined` — serialize that as JSON null, never the string
        // "undefined" (a completion value must always be valid JSON).
        if (JS_IsUndefined(result)) {
            JS_FreeValue(ctx, result);
            result = JS_NULL;
        }
        JSValue ser = JS_JSONStringify(ctx, result, JS_UNDEFINED, JS_UNDEFINED);
        JS_FreeValue(ctx, result);
        if (JS_IsException(ser)) {
            JS_FreeValue(ctx, ser);
            rc = -1;
            goto done;
        }
        size_t slen = 0;
        const char *stext = JS_ToCStringLen(ctx, &slen, ser);
        JS_FreeValue(ctx, ser);
        if (!stext) {
            rc = -1;
            goto done;
        }
        if (max_result_b > 0 && (int)slen > max_result_b) {
            JS_FreeCString(ctx, stext);
            rc = -7;
            goto done;
        }
        if (result_len_out)
            *result_len_out = (int)slen;
        {
            size_t copy = slen < (size_t)(out_cap - 1) ? slen : (size_t)(out_cap - 1);
            memcpy(out_buf, stext, copy);
            out_buf[copy] = 0;
        }
        JS_FreeCString(ctx, stext);
        if ((int)slen > out_cap - 1)
            rc = -7;
        else
            rc = 0;
    }
done:
    JS_SetContextOpaque(ctx, NULL);
    JS_FreeContext(ctx);
    if (timeout_ms > 0)
        JS_SetInterruptHandler(rt, NULL, NULL);
    if (rc < 0 && budget.interrupted)
        rc = -5;
    return rc;
}
