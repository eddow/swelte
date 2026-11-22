# `@swelte/create`

[![npm version](https://img.shields.io/npm/v/@swelte/create.svg)](https://www.npmjs.com/package/@swelte/create)
[![npm downloads](https://img.shields.io/npm/dm/@swelte/create.svg)](https://www.npmjs.com/package/@swelte/create)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/emedware)

Scaffold a new Swelte project:

```sh
npm create @swelte [<dir>] [--sample | --empty] [--template empty|sample|lib] [--ssr|--no-ssr] [--yes]
```

Interactive (TTY) wizard: directory → sample confirm → SSR confirm (default
SPA-only). Non-interactive (piped stdin, `CI=1`, `--yes`/`--no-interactive`)
uses flag defaults (empty, SPA).

Every starter is the same Swelte project shape, with `swelte build` for the
application (`dist/`) and `swelte package` for reusable `src/lib` code
(`package/`). Routes stay local to the application or demo. Starters include
both scripts and explicit publication metadata, and start private.

`--template lib` adds the reusable-V sample content (never a separate project type).
