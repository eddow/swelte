# `@swelte/create`

[![npm version](https://img.shields.io/npm/v/@swelte/create.svg)](https://www.npmjs.com/package/@swelte/create)

Scaffold a new Swelte project:

```sh
npm create @swelte [<dir>] [--sample | --empty | --lib] [--template empty|sample|lib] [--kind app|lib] [--ssr|--no-ssr] [--yes]
```

Interactive (TTY) wizard: directory → kind (App / Library) → sample confirm
(apps only) → SSR confirm (default SPA-only). Non-interactive (piped stdin,
`CI=1`, `--yes`/`--no-interactive`) uses flag defaults.

Libraries scaffold `src/lib` (published) plus a `src/routes` dogfood demo.
