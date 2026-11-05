# `@swelte/vvm`

[![npm version](https://img.shields.io/npm/v/@swelte/vvm.svg)](https://www.npmjs.com/package/@swelte/vvm)
[![npm downloads](https://img.shields.io/npm/dm/@swelte/vvm.svg)](https://www.npmjs.com/package/@swelte/vvm)

> 📚 [Documentation](https://swelte.emedware.dev/)

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

Once installed in a package, one can simply run `npx vvm ...`

```sh
npx @swelte/vvm install 0.5.2   # fetch toolchain into versions/
npx @swelte/vvm use 0.5.2       # mark active (.active-version, gitignored)
npx @swelte/vvm which           # print active `v` binary path
npx @swelte/vvm list            # installed versions
npx @swelte/vvm prepare --target-os linux --target-arch amd64  # zig + zig-cc wrapper (no flags = derive from $SWELTE_TARGET_OS/ARCH or package.json swelte key)
```

`@swelte/core`'s `toolchain.ts` prefers a system `v` on PATH, then falls
back to `vvm which` (installed dependency first, monorepo sibling second).
`swelte build --target-os/--target-arch` resolves the `zig-cc-<os>-<arch>`
wrapper the same way (vvm-managed first, then PATH `zig`); `npm i` runs
`prepare` automatically when the project declares `swelte.targetOs` /
`swelte.targetArch` in package.json.
