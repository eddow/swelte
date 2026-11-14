# Installed native/UI package fixture

Run `npm run test:dogfood` from the repository root. Requires the managed V
toolchain, a native C compiler and SQLite development headers/library. Uses
local npm pack/install; it does not publish or require provider/database secrets.

The test installs an ai1-shaped tarball with a Svelte component, a universal V
export and a server-only V module using interfaces, callbacks, channels, nested
modules, SHA-256 and SQLite. It checks generated TS declarations and browser
import rejection, builds the browser assets and native QuickJS server, then
asserts JSON and server-rendered HTML with an empty runtime PATH.

SQLite is only a native-link dependency for this packaging fixture. It does not
validate or replace PostgreSQL, migrations, pooling or application persistence.
This is not the full ai1 port. The command prints the tested toolchain versions;
Vite 6 remains the supported pilot baseline, without claiming Vite 8 support.

`ai1/src/lib` follows the library schema in `docs/libraries.md`: real
`svelte-package` output and declarations, raw native V exports, and author-only
`src/routes` excluded from the tarball.

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
Install libpq development files as well as SQLite development files to build.
See `fixtures/postgres/README.md` for the app-owned database integration.
