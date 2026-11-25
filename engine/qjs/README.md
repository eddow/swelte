# `@swelte/qjs`

[![npm version](https://img.shields.io/npm/v/@swelte/qjs.svg)](https://www.npmjs.com/package/@swelte/qjs)
[![npm downloads](https://img.shields.io/npm/d/npm/dm/@swelte/qjs.svg)](https://www.npmjs.com/package/@swelte/qjs)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/emedware)

> 📚 [Documentation](https://swelte.emedware.dev/)

Swelte embedded-QuickJS engine — leaf package (zero runtime deps): vendored
C sources, engine-owned glue, and the consumer-agnostic archive builder.

```ts
import { buildQjsLib, qjsCDir } from '@swelte/qjs'
```

The SSR adapter (`@swelte/ssr-qjs`) and the PTC agent plugin (`@swelte/ai`)
each build their own archive on top of this engine: the engine archive
(`libqjs.a`) holds vendored QuickJS + generic glue, and each consumer
compiles its own glue (`libqjs_render.a`, `libqjs_agent.a`) and links
consumer-after-engine. Bridges stay adapter-owned (`bridgeSrc` in
`@swelte/ssr-qjs`, `agentBridgeSrc` in `@swelte/ai`).

## Layout

```
c/        vendored QuickJS engine + engine-owned glue (swelte_qjs.*:
          runtime/context lifecycle, evaluation budgets, interrupt clock)
src/qjs.ts  archive builder (dist/qjs.js) + path helpers
```

Consumer glue lives with its owner: SSR render driver
(`engine/ssr-qjs/c/swelte_render.*` + self-contained
`routes/swelte_qjs_bridge.v`), agent eval (`engine/ai/c/swelte_agent.*` +
`engine/ai/v/agent.v`).

## Build

The archive builder (`src/qjs.ts` → `dist/qjs.js`, consumed via
`buildQjsLib`) compiles the engine sources with gcc
(`-O2 -D_GNU_SOURCE -DCONFIG_VERSION="2026-06-04" -fwrapv -fPIC`)
into `.swelte/qjs/libqjs.a` (mtime-guarded). Each consumer calls the same
builder with its own `sourceDir` + `archiveName` for its glue archive
(`libqjs_render.a`, `libqjs_agent.a`) — same compiler and target
configuration, dependency-ordered link (consumer after engine).
V's bundled tcc cannot compile `quickjs.c`, hence the prebuilt archives
(V links one `.a` per `#flag` — multiple `.o` files are not accepted).

See `c/README.md` for the vendored QuickJS version, file list, and upgrade notes.
