#ifndef SWELTE_QJS_H
#define SWELTE_QJS_H
#include "quickjs.h"
int swelte_qjs_new_runtime(void);
void swelte_qjs_free_runtime(int handle);
JSRuntime *swelte_qjs_rt_at(int handle);
typedef struct {
    uint64_t start_ms;
    int timeout_ms;
    int interrupted;
} swelte_qjs_budget;

uint64_t swelte_qjs_now_ms(void);
int swelte_qjs_interrupt(JSRuntime *rt, void *opaque);
#endif
