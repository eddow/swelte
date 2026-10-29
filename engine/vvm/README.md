# `@swelte/vvm`

V Version Manager — installs and manages V toolchains inside `node_modules` (nvm for V).

## Why

Swelte pins a V version per project (`0.5.2` today) without touching the
user's system V. `postinstall` fetches the toolchain once; everything
else (`swelte dev`, `v run`, `v -b wasm`) resolves through it.

## Layout

```
bin/
  vvm.js          `vvm install <ver> | use <ver> | which | list` (+ postinstall hook).
  v-shim.js       `v` on PATH: forwards to the active toolchain binary.
  postinstall.js  runs on `npm install`: ensures the pinned V is present.
versions/
  v0.5.2/         the actual toolchain (gitignored, downloaded — never committed).
```

## Commands

```sh
npx vvm install 0.5.2   # fetch toolchain into versions/
npx vvm use 0.5.2       # mark active (.active-version, gitignored)
npx vvm which           # print active `v` binary path
npx vvm list            # installed versions
```

`@swelte/core`'s `toolchain.ts` prefers a system `v` on PATH, then falls
back to `vvm which` (installed dependency first, monorepo sibling second).
