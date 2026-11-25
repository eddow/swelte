# Tasks

## 1. Extract shared engine primitives

- [x] 1.1 Extract runtime/context lifecycle, evaluation, job pumping, limits, and explicit callback context from consumer glue. Verify engine tests exercise successful evaluation, exceptions, time/memory limits, and cleanup.
- [x] 1.2 Restrict the engine archive to generic sources and document its V/C boundary. Verify it builds without either consumer's files and preserves target compiler selection.

## 2. Move SSR ownership

- [x] 2.1 Move render driver, module loading conventions, render cache, HTML/head extraction, and failure mapping into ssr-qjs. Update bridge generation and native archive linking. Verify existing SSR tests and a native SSR-only link.
- [x] 2.2 Update SSR package files and ownership documentation. Verify packed installation contains all rendering sources and produces equivalent HTML/head and strict failure behavior.

## 3. Move AI ownership

- [x] 3.1 Move agent V/C execution helpers, bindings, dispatch integration, call budgets, result limits, and failure mapping into ai. Verify existing AI tests, budget boundary cases, and dispatcher-unavailable regression behavior.
- [x] 3.2 Replace shared static callback state with explicit execution context ownership where needed. Verify overlapping evaluations cannot exchange bindings or counters and failure paths release state.
- [x] 3.3 Update AI staging, native linking, package files, and ownership documentation. Verify a packed AI-only consumer builds and evaluates programs without SSR files.

## 4. Verify combined consumers

- [x] 4.1 Remove obsolete shared consumer exports and update all internal imports and compatibility documentation. Verify repository references and TypeScript/V builds have no stale entry points.
- [x] 4.2 Run existing package/link and installation coverage for SSR-only, AI-only, and combined consumers. Verify one engine archive, no duplicate symbols, target-specific outputs, and rebuild invalidation after header/source changes.
- [x] 4.3 Refresh Trail after implementation and run trail check. Verify ownership documentation and indexed code agree.
