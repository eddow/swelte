# Installed native/UI package fixture

The fixture is test material for Swelte, not an application to finish. Its
routes and package are intentionally synthetic; only the capability asserted
by each test matters. Run `npm run test:dogfood` from the repository root. It
requires the managed V toolchain, a native C compiler, and — for backend-hub
builds (rooms/WS) — the SQLite amalgamation, which `swelte build` fetches
lazily via `vvm ensure-sqlite` when absent (cached under the managed
toolchain, gitignored; or provide system headers, e.g. `libsqlite3-dev`).
The fixture uses local npm pack/install; it does not publish or require
provider/database secrets.

The test installs a synthetic library tarball with a Svelte component, a
universal V export and a server-only V module using interfaces, callbacks,
channels, nested modules and SHA-256. It checks generated TS declarations and
browser import rejection, builds the browser assets and native QuickJS server,
then asserts JSON and server-rendered HTML with an empty runtime PATH.

The PostgreSQL probe is separate and uses V's existing `db.pg`; this sample
library does not implement or replace an ORM. It does not copy or port another
repository's product library. The command prints tested toolchain versions;
Vite 6 remains the supported pilot baseline, without claiming Vite 8 support.

The synthetic `sample-lib/src/lib` follows the library schema in
`docs/libraries.md`: real `svelte-package` output and declarations, raw native V exports, and author-only
`src/routes` excluded from the tarball.

For editor type resolution in the checked-in fixture, run
`npm run prepare:dogfood` from the repository root after installing the root
dependencies and building the engine packages. It builds the sample library's
declarations and installs the consumer's local `file:../sample-lib` dependency.
`contract.ts` and the Svelte page then resolve the actual package exports.
The test runner excludes local generated output when copying fixtures and
replaces this local dependency with a freshly packed tarball, so its installed
package assertions still exercise the published layout.

Run `npm run test:dogfood -- --browser` to verify hydration retains SSR DOM,
wrapper context, reactive locale/query state, inline failures and refreshes
that preserve component state. Set `SWELTE_TEST_BROWSER` to Chromium if it
is not installed in a standard location or the Playwright cache.
It also covers dynamic-route SSR/hydration and decoded params, history,
overlapping actions/refresh/navigation, and deliberate strict-hydration failure.

The native suite also exercises guarded SSE/WS headers and cookies, raw POST
streams, fragmented UTF-8, errors, disconnects and idle cleanup.
Stalled-reader checks verify raw POST and GET SSE producers are released even
when the client keeps the connection open but stops consuming bytes.
Strict native SSR checks render, timeout and output failures, head-buffer
growth and subsequent healthy requests.
The suite also validates translated grouped dynamic prerender artifacts,
canonical/head content, opt-outs, redirect/error exclusion and owned-artifact
cleanup. Browser mode hydrates an actual artifact from a static host and checks
that `$app/state.url` uses that host's origin.

`--keep` retains the generated scratch project for debugging. To measure that
native binary, run `npm run measure:dogfood -- <scratch>/app [report.json]`.
See [measurement method and sample](../../docs/native-runtime-measurements.md)
for startup/RSS/HTML/stream concurrency results and their scope.

Run `npm run test:postgres -- --browser` with PostgreSQL client commands on
PATH and a local role allowed to create databases. Standard `PGHOST`, `PGPORT`,
`PGUSER` and authentication settings apply. It creates and drops only its own
randomly named database; it never applies migrations to an existing app DB.
The managed V toolchain must have its SQLite amalgamation installed, and the
native build needs libpq development files. These are dependencies of the
fixture plugins; Swelte does not build a PostgreSQL or SQLite ORM.
See `fixtures/postgres/README.md` for the isolated PostgreSQL behavior tested
for Swelte's native build integration.
