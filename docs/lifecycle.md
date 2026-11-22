# Native lifecycle and reporting

Server hooks live in `src/app.v`. They are not routes or browser exports.

```v
module app

import backend

@[startup]
pub fn initialize() ! {
    backend.initialize_database()!
}

@[shutdown]
pub fn cleanup() ! {
    backend.close_database()!
}

@[report]
pub fn observe(event SwelteReport) {
    // Adapt to the application's server-side logger/telemetry.
    // event.message contains original native error text for error events.
    println('${event.phase} ${event.request_id} ${event.path} ${event.status}')
}
```

Startup and shutdown each take no parameters and return `void` or `!void`.
There is at most one hook of each kind. Startup runs before plugin startup
fragments, cron schedulers or the server listener. Explicit returns and errors
stay inside the startup function. Failure aborts boot without starting jobs or
running the shutdown hook. Partially initialized resources belong to the
startup function's own error cleanup.

## Shutdown

Swelte connects to the bundled V server's existing `veb.Server.shutdown`.
SIGTERM and SIGINT record a stop request; allocation, locks and cleanup happen
on ordinary threads outside the signal handler.

Development also accepts stop requests over the controller's private loopback
connection. The child authenticates with a per-launch token, protocol version,
generation and PID; lifecycle messages never share application HTTP or logs.
The connection is established before `@[startup]`. A stop command or controller
EOF enters the same idempotent `request_stop` path as standalone OS signals.
`ready` is emitted only after startup and the HTTP listener are ready. The
controller waits for process exit, not just the `stopped` message, before
replacement. A controller disconnect during a blocked startup is bounded by
the same shutdown deadline. Native children launched by `swelte dev` disable
OS shutdown handlers because normal dev lifecycle uses cooperative commands.

Shutdown stops admission, wakes registered streams and stops accepting HTTP
connections. The framework waits for admitted request work, detached load/verb
watchdog tasks, stream producers/writers and the cron scheduler. Timed-out
handlers still run and remain counted until they finish. Cron sleeps and retry
backoff are interruptible; an executing tick must return cooperatively.

Taken-over connections have one closing owner. Shutdown interrupts socket I/O;
writers release cancellation channels and room subscriptions, including repeat
subscriptions to the same room. Idle GET SSE sends heartbeat comments so a
disconnected subscriber can be detected without a new room message. A completed
WS handler flushes queued text and closes normally; server shutdown cancels
connections rather than guaranteeing completion of a peer close handshake.

After tracked work drains, the shutdown hook runs once to close shared resources.
`SWELTE_SHUTDOWN_TIMEOUT_MS` (default 10000) bounds HTTP drain, registered work
and cleanup together. A work timeout exits with code 1 and skips resource cleanup
that could race active work. A cleanup error or timeout also exits with code 1.
Successful cleanup exits with code 0. Repeated signals do not repeat cleanup.
`SWELTE_SHUTDOWN_SIGNALS=0` leaves signal policy with the process owner.

App-created background threads must be stopped/joined by their owner before
closing the resources they use, normally in the shutdown hook. The framework
cannot terminate arbitrary V code. Acquire stream-owned upstream resources
inside the producer callback and release them with `defer` and cancellation.
This is cooperative process lifecycle, not durable queue/restart semantics.

## Reporting

`@[report]` takes one `SwelteReport` and returns `void` or `!void`. Parameter
names are unrestricted. The callback is server-only and synchronous; keep it
short and make its own resource use safe during startup/shutdown errors.
Reporter errors produce a generic console diagnostic without changing responses.

| Field | Meaning |
|---|---|
| `phase` | `request`, `handler-error`, `load-error`, `action-error`, `ssr-error`, `stream-error`, `job-error`, `startup-error` or `shutdown-error` |
| `request_id` | Server-generated correlation ID; empty for jobs/lifecycle |
| `method`, `path` | HTTP context; path excludes the query; jobs use `cron/<name>` |
| `status` | HTTP status for request events; failure status for error events |
| `duration_ms` | Request elapsed time; zero when unavailable |
| `message` | Original native error message for errors; empty for request events |

`X-Swelte-Request-Id` is returned to clients and supplied to native handlers in
`req.headers['x-swelte-request-id']`. Client-supplied values are replaced. Reports
do not automatically include request bodies, cookies, locals or query strings.
The callback owns redaction/export of error messages. Default lifecycle/cron/
stream diagnostics use generic reasons rather than original error text.

Request events measure request handling, through headers/takeover for streams;
they are not full subscriber/run duration measurements. Producer failures after
headers cannot change the HTTP status. SSR hooks report renderer failures;
native bridge logs provide timeout/memory/output reason codes. Original JS
stacks are not exported through this hook. Native libraries can retain their
own job context and associate it with the request ID where useful.

`npm run test:dogfood -- --browser` verifies lifecycle ordering, repeated signals,
drain and deadline behavior, idle/repeated room cleanup, reporting isolation and
normal WS completion. `npm run test:dogfood:postgres -- --browser` also verifies pool
cleanup after native work and failed migrations before plugin startup (self-managed temp DB; bring your own via `test:dogfood -- --postgres` + `DATABASE_URL`).
