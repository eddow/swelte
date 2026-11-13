# Native PostgreSQL integration

Run `npm run test:postgres` (optionally `-- --browser`). Requires PostgreSQL
client tools, a role with CREATEDB, libpq and SQLite development files, a C
compiler and the managed V toolchain. Production needs libpq's runtime library;
neither Node nor a database sidecar is used by the native server fixture.

V already supplies `db.pg`, pooling, bound parameters, transactions and ORM
support. This fixture connects those facilities to app-owned startup, backend
modules, guarded loads and named form mutations. No framework ORM is needed.
`src/lib/backend` V modules are staged into native compilation alongside
generated routes; use ordinary V imports such as `import backend`.

The example uses its own checksum ledger to test migration replay, coordinated
initialization and transactional failure. An existing application must reconcile
its existing migration history rather than create a second ledger blindly.
Startup publishes the pool only after migrations succeed and starts dependent
work afterward. Session advisory locks use a dedicated physical connection,
explicit unlock and unconditional close; the tested V toolchain's connection
reset hook does not clear session locks automatically.

Tests cover injection-safe parameters, SQL NULL, UUID, UTC timestamps, JSONB,
decimal text, rollback, replay, checksum mismatch, failed migrations and lock
contention/cleanup. The fixture is not a port of the application's complete
schema, authorization or RunStore.
