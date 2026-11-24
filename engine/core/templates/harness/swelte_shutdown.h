#ifndef SWELTE_SHUTDOWN_H
#define SWELTE_SHUTDOWN_H
#include <signal.h>
#include <stdio.h>
#ifndef _WIN32
#include <errno.h>
#include <sys/select.h>
#include <time.h>
/* V 0.5.2's OpenSSL select helper returns EINTR before its retry branch.
 * GC/thread signals can interrupt HTTPS while a browser's SSE is connected.
 * Retry the wait (never the HTTP request), preserving sets and the deadline. */
static int swelte_select_restart(int nfds, fd_set *r, fd_set *w, fd_set *e,
                                 struct timeval *timeout) {
    fd_set r0, w0, e0;
    if (r) r0 = *r;
    if (w) w0 = *w;
    if (e) e0 = *e;
    struct timespec now;
    long long deadline = 0;
    if (timeout) {
        clock_gettime(CLOCK_MONOTONIC, &now);
        deadline = (long long)now.tv_sec * 1000000 + now.tv_nsec / 1000
                 + (long long)timeout->tv_sec * 1000000 + timeout->tv_usec;
    }
    for (;;) {
        int result = select(nfds, r, w, e, timeout);
        if (result >= 0 || errno != EINTR) return result;
        if (r) *r = r0;
        if (w) *w = w0;
        if (e) *e = e0;
        if (timeout) {
            clock_gettime(CLOCK_MONOTONIC, &now);
            long long left = deadline - ((long long)now.tv_sec * 1000000 + now.tv_nsec / 1000);
            if (left < 0) left = 0;
            timeout->tv_sec = left / 1000000;
            timeout->tv_usec = left % 1000000;
        }
    }
}
#define select swelte_select_restart
#endif
#ifdef _WIN32
#include <windows.h>
#endif
static int swelte_atomic_replace(const char *src, const char *dst) {
#ifdef _WIN32
    wchar_t a[32768], b[32768];
    if (!MultiByteToWideChar(CP_UTF8, 0, src, -1, a, 32768) || !MultiByteToWideChar(CP_UTF8, 0, dst, -1, b, 32768)) return -1;
    return MoveFileExW(a, b, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) ? 0 : -1;
#else
    return rename(src, dst);
#endif
}
/* The signal handler only records a signal. Allocation, locks, socket teardown
 * and application cleanup run on ordinary V threads, outside signal context. */
static volatile sig_atomic_t swelte_stop_signal = 0;
static void swelte_record_stop(int signo) { swelte_stop_signal = signo; }
static int swelte_install_stop_signals(void) {
    if (signal(SIGTERM, swelte_record_stop) == SIG_ERR) return 0;
    if (signal(SIGINT, swelte_record_stop) == SIG_ERR) return 0;
    return 1;
}
static int swelte_received_stop(void) { return (int)swelte_stop_signal; }
#endif
