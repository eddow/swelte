# `@swelte/vvm`

[![npm version](https://img.shields.io/npm/v/@swelte/vvm.svg)](https://www.npmjs.com/package/@swelte/vvm)
[![npm downloads](https://img.shields.io/npm/dm/@swelte/vvm.svg)](https://www.npmjs.com/package/@swelte/vvm)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/emedware)

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
npx @swelte/vvm ensure-sqlite  # SQLite amalgamation for the active toolchain (db.sqlite headers; lazy — `swelte build` fetches it only when a backend-hub build needs it and it is absent)
```

## System V (already installed globally)

A V that is already on PATH is a first-class version — listed, usable,
never downloaded, never removed:

```sh
npx vvm list              # … plus `system (0.6.x at /usr/bin/v)` when one exists
npx vvm use system        # adopt it (.active-version=system + .active-system-path pin)
npx vvm exec system -- version
npx vvm use 0.5.2         # back to managed
npx vvm uninstall system  # refused — it lives outside vvm (deselect, don't delete)
```

Rules: `use system` records the path (pinned, survives PATH changes) and
follows live upgrades while the binary exists. If it vanishes, vvm errors
with the pin that went missing (`vvm use 0.5.2` to go back). `postinstall`
with `system` active skips the download entirely. `link` while system is
active is a no-op (it IS global already). `VVM_SYSTEM_V=/path/to/v`
points detection at an explicit binary (handy on Windows).

## System link (VSCode)

VSCode's V extension looks for a **global** `v` on PATH, while vvm
deliberately keeps toolchains inside `node_modules`. Bridge the two
(opt-in — vvm never touches the system unless you ask):

```sh
npx vvm link              # ~/.local/bin/v → active toolchain (symlink; v.cmd shim on Windows)
npx vvm link --global     # /usr/local/bin/v (needs root) — visible to every app incl. VSCode
npx vvm link --dir ~/bin  # any dir already on your PATH
VVM_LINK=1 npm install    # auto-link on every install (postinstall); VVM_LINK_DIR picks the dir
npx vvm status            # active version + link state (STALE after `vvm use X` → re-run link)
npx vvm unlink            # remove the entry-point again
```

Details:

- `use system` adopts the already-installed global V (never downloaded):
  pinned path + live-upgrade follow; `status` shows it.
- `install --link` / `VVM_LINK=1` links right away; `use <managed>` refreshes an
  existing link so `vvm use X` never leaves a stale `v` on PATH. `use system`
  never re-points the link on its own (system is global already — pass `--link`
  to force it); `link` while system is active says so and exits 0.
- `postinstall` with `system` active skips the download; otherwise it only
  refreshes a **stale** managed link — it never creates one uninvited
  (unless `VVM_LINK=1`), and never re-points toward system on its own.
- `uninstall` removes a managed version only: never the active one, never
  `system` (outside vvm — deselect it with `use`, don't delete it).
- `link` refuses to clobber a non-vvm `v` (a real system install wins);
  `link --force` overrides. Same guard on `unlink`.
- Restart VSCode after linking — it reads PATH on launch.

`@swelte/core`'s `toolchain.ts` prefers a system `v` on PATH, then falls
back to `vvm which` (installed dependency first, monorepo sibling second).
`swelte build --target-os/--target-arch` resolves the `zig-cc-<os>-<arch>`
wrapper the same way (vvm-managed first, then PATH `zig`); `npm i` runs
`prepare` automatically when the project declares `swelte.targetOs` /
`swelte.targetArch` in package.json.
