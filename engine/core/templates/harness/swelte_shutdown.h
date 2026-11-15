#ifndef SWELTE_SHUTDOWN_H
#define SWELTE_SHUTDOWN_H
#include <signal.h>
#include <stdio.h>
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
