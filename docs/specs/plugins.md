# Explicit Swelte plugins and restoration of Plus

The application will enable framework extensions through the existing `swelte({ plugins: [...] })` configuration. Core owns discovery of application source, V parsing, route and server generation, lifecycle ordering, and staging generated files. AI owns tool declarations and dispatch. Plus will again own jobs and the embedded backend services. This roadmap supersedes the automatic dependency discovery prototype described in [the AI spec](ai.md). Each checkbox below is planned work.

## 1. Extend the existing plugin contract

- [x] Give a registered plugin access to the parsed declarations it claims, their source, structs, module path and location. Cover `src/app.v`, routes and backend/shared library files. Keep application startup in `src/app.v`. An enabled plugin can contribute startup and shutdown calls to library code through the generated server.
- [x] Add a generation hook that returns named output files. Core validates ownership, rejects collisions and prunes stale output on regeneration or plugin removal. Support contributions such as CLI commands and runtime includes even when an app declares no matching attributes.
- [x] Resolve the configured plugins consistently for dev, check, build and CLI commands. Define initialization order relative to application startup, reverse cleanup order, and failure behavior. Verify with two fixture plugins and an application startup hook.

## 2. Move AI onto explicit registration

- [x] Expose the AI tools generator as a Swelte plugin and enable it in the shell example. Replace the automatic `./swelte/build` lookup and update its documentation and tests.
- [x] Build a provider-only app without the plugin and a tool-using app with it. Verify that only the latter emits bindings and can call a selected native tool. Remove the plugin and regenerate in the same output directory to check cleanup.

## 3. Restore Plus feature by feature

- [x] Move cron parsing, schedule validation, retry and durable scheduling, V runtime and startup wiring back into `engine/plus`. Verify an app-declared tick starts once and survives the existing retry and persistence tests.
- [ ] Move embedded SQLite/KV, migration helpers and the `migrate` command into Plus. Make the configured command discoverable before an app build. Verify pending and applied migrations against an existing database.
- [ ] Move the room hub and its SSE/WebSocket integration into Plus. Core retains the HTTP, SSE and WebSocket transport primitives. Identify the route-generation hooks needed for room dispatch and native module inclusion. Exercise room broadcast and disconnect in a Plus app and ordinary streaming in a core-only app.
- [ ] At each extraction, remove the corresponding builtin registration and feature-specific branches from core. Keep dependency direction from Plus to the core plugin API. Update the consuming examples and scaffolds in the same change.

## 4. Verify the package and release boundary

- [ ] Build clean consumers from packed packages with core alone, core + Plus, and core + Plus + AI. Check CLI discovery, native linking and startup through the normal application entry points. A core-only app should build without the embedded SQLite runtime.
- [ ] Inventory public imports against the last published versions. Restore the Plus entry points in use, document any migration from the unreleased core layout, align package versions and update the release selector that currently treats Plus as retired.
- [ ] Replace the Plus deprecation notice and update the CLI, configuration and library-authoring guides with explicit registration examples. Review remaining core features separately against concrete package consumers.

[Existing plugin contract](../../engine/core/src/vite/types.ts) · [Historical Plus behavior](../plus.md) · [Release policy](versioning.md)

PS:
- at the end of the day, all the docs have to be updated: docs/*.md, skills, docs-site - at best these are maintained but a final review will be needed
- all deprecated/retired "functionalities" have to be reviewed for cleanup