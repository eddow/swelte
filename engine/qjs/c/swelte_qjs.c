#include <time.h>
#include <pthread.h>
#include "quickjs.h"
#include "swelte_qjs.h"
#define SWELTE_QJS_MAX_RUNTIMES 64
static pthread_mutex_t swelte_qjs_mu = PTHREAD_MUTEX_INITIALIZER;
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

// Sibling-glue lookup: the agent eval entry shares this table.
JSRuntime *swelte_qjs_rt_at(int handle) {
    pthread_mutex_lock(&swelte_qjs_mu);
    int i = handle - 1;
    int valid = (i >= 0 && i < SWELTE_QJS_MAX_RUNTIMES && swelte_qjs_rt_used[i]);
    JSRuntime *rt = valid ? swelte_qjs_rts[i] : NULL;
    pthread_mutex_unlock(&swelte_qjs_mu);
    return rt;
}

uint64_t swelte_qjs_now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

int swelte_qjs_interrupt(JSRuntime *rt, void *opaque) {
    (void)rt;
    swelte_qjs_budget *b = (swelte_qjs_budget *)opaque;
    if (b->timeout_ms <= 0)
        return 0;
    if (swelte_qjs_now_ms() - b->start_ms >= (uint64_t)b->timeout_ms) {
        b->interrupted = 1;
        return 1;
    }
    return 0;
}

