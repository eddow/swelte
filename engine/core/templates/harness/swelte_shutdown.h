#ifndef SWELTE_SHUTDOWN_H
#define SWELTE_SHUTDOWN_H
#include <signal.h>
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
