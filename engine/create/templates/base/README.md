# __NAME__

Swelte app — V (native server binary) + Svelte 5 + WebAssembly client modules.

## Develop

```sh
npm install
npm run dev      # Vite :5174 + V backend :8131, one command
```

## Build & run — two builds, one artifact

`swelte build` typechecks, compiles `dist/server` (single artifact) and
emits the static output into `dist/`. Which machine it targets depends on
the deploy declaration (`package.json:swelte.targetOs/targetArch`,
set by `swelte deploy`):

```sh
npm run build         # deploy target when declared, else this machine
npm run build:local   # always this machine — feeds `swelte preview` below
npm run preview       # serve dist/ + API on one port, no Vite involved
```

Cross-compiling for a deploy target writes a foreign binary that cannot boot
here — verify with artifacts only, then ship (`swelte preview` only runs
host-native output).

`dist/` + `dist/server` are build outputs — never committed (`.gitignore`).

## Deploy

<!-- swelte:deploy -->

`swelte deploy` writes the platform wrapper for this layout
(`Dockerfile` + ignores, `package.json:swelte.targetOs/targetArch`) and
**replaces this block** with the target's recipe:

```sh
swelte deploy init --target vercel    # Dockerfile.vercel + .vercelignore
swelte deploy init --target docker    # plain Dockerfile
swelte deploy init --target fly       # + fly.toml
swelte deploy init --target railway   # + railway.json
swelte deploy init --target render    # + render.yaml
swelte deploy init --target static    # dist/.swelte-static, no Dockerfile
swelte deploy status                  # drift check (CI)
```

<!-- /swelte:deploy -->

User prose goes below — everything outside the markers is yours.

