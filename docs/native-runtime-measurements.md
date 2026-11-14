# Native fixture measurements

`npm run measure:dogfood -- <retained-fixture-app> [report.json]` measures an
already built dogfood fixture. First build one with
`npm run test:dogfood -- --browser --keep`; use the printed scratch directory's
`app` subdirectory. The measurement command starts its own binary on an ephemeral
port, runs with an empty server PATH and strict embedded QuickJS SSR, validates
responses, then sends SIGTERM and requires successful cleanup. It does not start
a server-side Node process. Node drives the workload outside the server.

The JSON report records host/CPU, binary size, native runtime dependencies,
startup through the first successful rendered HTML response, Linux RSS/high-water
memory, HTML completion times, streaming first-event/completion times and batch
throughput. RSS is sampled every 20ms; `/proc` high-water memory is also recorded.
Other platforms omit `/proc` memory/executable checks. `ldd` is required on Linux.
Do not pass a real application's working directory: this harness expects the
retained fixture binary and its test routes/reporting behavior.

The request pool runs at concurrency 1, 8 and 32, with 64 HTML and 32 stream
requests per level, after eight HTML warmups. Each HTML response must contain
the requested locale and rendered title. Each POST stream must contain a full
UTF-8 delta and done frame. The producer deliberately waits 200ms between them.
The harness raises the rate limit to 100000 requests/minute for its own child;
the default 120/minute would measure admission rejection during this workload.

## Recorded sample, 2026-11-14

[Raw report](../fixtures/dogfood/measurements/2026-11-14-linux-x64.json).
Linux x64, Intel i9-12900 (24 logical CPUs), bundled V 0.5.2 7647ce1,
Svelte 5.57.3, Vite 6.4.5, TypeScript 5.9.3. Client: Node 22.14.0 fetch.
The fixture binary uses the test runner's default V compilation without `-prod`.
Its installed dependency exercises SQLite/native linking and its reporting hook
writes files; cron remains enabled. This is a short loopback functional workload,
without TLS, a real provider, PostgreSQL traffic, or a comparison server.

Startup through first HTML: 26.08ms. Ready RSS: 30.11MiB; sampled peak RSS: 64.40MiB.

| Concurrency | HTML p50 / p95 (ms) | Stream first event p50 / p95 (ms) | Stream completion p50 / p95 (ms) |
|---|---|---|---|
| 1 | 2.73 / 7.77 | 1.36 / 5.97 | 201.75 / 206.31 |
| 8 | 2.45 / 13.18 | 2.02 / 4.21 | 201.83 / 205.40 |
| 32 | 17.99 / 32.20 | 3.52 / 4.29 | 203.97 / 205.07 |

These values describe this machine and fixture run. They establish neither
production capacity nor a performance improvement over another stack. DF-17
still requires production build/deployment dependencies and representative
application/provider/database workloads, longer concurrency/cleanup runs and
an equivalent comparison workload before comparative claims.
