# Completed dogfood work

The dogfood work in commits `755185a`, `c134560`, `321b1d4` and `ec53726`
closed the framework gaps found while reviewing application requirements.
The fixtures remain synthetic probes of Swelte. Application features and ports
belong to their owning repositories.

## Delivered behavior

- **Installed libraries:** packed Svelte/V dependencies, generated declarations,
  nested native modules, server-only import boundaries, package-private imports
  and CommonJS dependencies work through the browser and QuickJS builds.
- **Page lifecycle:** guarded loads, request-local SSR state, nested wrapper data
  and head output, hydration, navigation, invalidation, history and stale-result
  suppression share the [page lifecycle contract](../page-lifecycle.md).
- **Forms:** named actions, no-JS responses, enhanced submissions, multipart
  bytes, cancellation, inline failures and awaited refresh retain page state.
- **Native transport and lifecycle:** POST streaming, SSE and WebSockets have
  guard coverage, bounded buffering, disconnect cleanup and shutdown draining.
  Startup ordering and server-side reporting are documented in
  [lifecycle](../lifecycle.md) and [streaming](../streaming.md).
- **SSR reliability:** strict rendering/hydration, bounded diagnostics, cache
  concurrency, installed-package composition and CLI cleanup have regression
  coverage. Original QuickJS diagnostics are opt-in; see [SSR](../ssr.md).
- **Prerendering:** grouped and dynamic routes, encoded parameters, inherited
  opt-outs, canonical/head output and safe artifact cleanup are covered.
- **Native integration:** the PostgreSQL fixture exercises V's existing ORM,
  driver, transactions and pooling. Swelte does not need another database
  implementation. [Runtime measurements](../native-runtime-measurements.md)
  provide a repeatable synthetic workload with explicit limits.

## Verification and maintenance

Core, SSR and Plus tests cover framework contracts. `npm run test:dogfood -- --browser` exercises native and browser behavior; `--prod` selects optimized
native compilation. `npm run test:postgres -- --browser` probes a disposable
PostgreSQL database. `swelte-ssr check` checks built SSR artifacts and exits
after shutting down its probe processes. The example suite covers build,
preview, browser navigation and dev/HMR behavior.

For source-fixture editor types, run `npm run prepare:dogfood`. The integration
runner still installs a freshly packed library independently of local output.
See the [fixture README](../../fixtures/dogfood/README.md) for prerequisites.

This roadmap is complete within its framework scope. Remaining framework
proposals live in [future.md](future.md); new fixture findings should describe
a concrete missing behavior there rather than reopen application requirements.
