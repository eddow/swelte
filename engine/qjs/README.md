# `@swelte/qjs`

[![npm version](https://img.shields.io/npm/v/@swelte/qjs.svg)](https://www.npmjs.com/package/@swelte/qjs)
[![npm downloads](https://img.shields.io/npm/d/npm/dm/@swelte/qjs.svg)](https://www.npmjs.com/package/@swelte/qjs)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/emedware)

> 📚 [Documentation](https://swelte.emedware.dev/)

Swelte embedded-QuickJS engine — leaf package (zero runtime deps): vendored
C sources, the shared V module, and the consumer-agnostic archive builder.

```ts
import { buildQjsLib, qjsCDir } from '@swelte/qjs'
```

The SSR adapter (`@swelte/ssr-qjs`) and the PTC agent plugin (`@swelte/ai`)
both consume `buildQjsLib` and link one `.swelte/qjs/libqjs.a`. The SSR
bridge template (`bridgeSrc`) stays adapter-owned in `@swelte/ssr-qjs`.

## Layout

```
c/        vendored QuickJS engine + Swelte-owned glue (swelte_qjs.*, swelte_agent.*)
qjs.v     shared V half (module qjs): budgets, failure taxonomy, buffer discipline
agent.v   agent V half (module qjs): agent_eval + budgets
src/qjs.ts  archive builder (dist/qjs.js) + path helpers
```

## Build

The owning consumer's TS (`src/qjs.ts` → `dist/qjs.js`, consumed via
`buildQjsLib`) compiles each `.c` with gcc
(`-O2 -D_GNU_SOURCE -DCONFIG_VERSION="2026-06-04" -fwrapv -fPIC`)
and archives them + the glue objects into the shared
`.swelte/qjs/libqjs.a` (mtime-guarded — the second consumer no-ops).
V's bundled tcc cannot compile `quickjs.c`, hence the prebuilt archive
(V links one `.a` per `#flag` — multiple `.o` files are not accepted).

See `c/README.md` for the vendored QuickJS version, file list, and upgrade notes.
