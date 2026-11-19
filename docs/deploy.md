# Deploy setup: `swelte deploy` (config automater, setup only)

Swelte's deploy model is **prebuilt**: `npm run build` (linux/amd64 from
the `package.json` declaration) produces `dist/` + `dist/server` (single
artifact), then the platform CLI uploads (`vercel deploy`). `npm run
build:local` forces host-native for local preview (`swelte preview`).
`swelte deploy` generates the wrapper files that model needs — it never
ships anything itself (no creds, no subprocess to `vercel`/`docker`/`fly`,
no network).

## `swelte deploy init [--target <t>]` (default: `vercel`)

Generates (compare-then-write, re-runnable), patches `package.json`'s
`swelte.targetOs/targetArch`, and refreshes the managed
`<!-- swelte:deploy -->` block in `README.md`:

| Target | Files | Ship |
|---|---|---|
| `vercel` | `Dockerfile.vercel` + `.dockerignore` + `.vercelignore` | `vercel deploy --prod` |
| `docker` | `Dockerfile` + `.dockerignore` | `docker build -t …` |
| `fly` | `Dockerfile` + `.dockerignore` + `fly.toml` | `fly deploy` |
| `railway` | `Dockerfile` + `.dockerignore` + `railway.json` | `railway up` |
| `render` | `Dockerfile` + `.dockerignore` + `render.yaml` | `git push` (auto-deploys) |
| `static` | no files — writes `dist/.swelte-static` via the existing `--target static` shim | any static host |

`package.json`: only `swelte.targetOs/targetArch → linux/amd64` (when
unset; `--force` overwrites). Scripts untouched — exactly two builds
exist (below).

Dockerfile naming rule: **`Dockerfile.vercel` only for `--target vercel`**
(Vercel picks the Dockerfile path from project settings; the `.vercel`
suffix keeps it distinct in repos that also ship a generic `Dockerfile`).
Every other target uses plain `Dockerfile` (overridable with `--dockerfile`).

Two builds, one artifact (kept, never touched):

- **`build`** (`swelte build`) — deploy target when the declaration exists,
  else this machine.
- **`build:local`** (`swelte build --local`) — always this machine,
  feeds `swelte preview` (which only runs host-native output).

No `build:deploy`: it was a redundant third alias for `build`. No
`preview:deploy`: the ship commands (`vercel deploy --prod`,
`docker build -t …`, `fly deploy`, `railway up`, `git push`) are
one-liners documented in the Dockerfile + README recipes, not scripts.

Detection (never prompted):

- **SSR**: `@swelte/ssr-qjs` in deps → `SWELTE_SSR=1`, else SPA-only.
- **`distDir`**: from `svelte.config.js` (`loadConfig`), default `dist`.
- **Root Directory hint**: monorepo-relative path in the Dockerfile comment
  (omitted for standalone projects).

```
swelte deploy init --target vercel   # Dockerfile.vercel + .dockerignore + .vercelignore
swelte deploy init --target fly      # Dockerfile + .dockerignore + fly.toml
swelte deploy init --target railway  # Dockerfile + .dockerignore + railway.json
swelte deploy init --target render   # Dockerfile + .dockerignore + render.yaml
swelte deploy init --target static   # dist/.swelte-static (packaging only)
swelte deploy --target docker --dockerfile Dockerfile.prod --dry-run
swelte deploy init --target vercel --force   # overwrite an existing non-linux targetOs
```

## `swelte deploy status [--format text|json]` / `--check`

Read-only drift check (CI/agents): each file `ok` / `missing` / `drift`,
plus the `package.json` declaration state. Exits non-zero on drift with the
fix hint (`swelte deploy init --target <t>`). `--check` on `init` is the
same verification without writes (mirrors `swelte check`).
`README.md` has no drift state: only the marker-delimited region is managed,
prose outside it is never compared.

```
npm run build && vercel deploy            # preview
vercel deploy --prod                      # production
```

## Phasing

All common targets built: `vercel` + `docker` + `fly` + `railway` +
`render` + `static` (packaging-only). `vercel` is dogfooded
(`swelte deploy status` is green on `examples/docs-site`).

## `@clack/prompts`: no new `@swelte/cli` package

`deploy init` is **fully flag-driven, no prompts** (defaults: vercel,
`Dockerfile.vercel`, linux/amd64) — same contract as `npm create @swelte
--yes` (non-interactive). `@clack/prompts` stays where it is (`@swelte/create`
only, a runtime dep there). Core stays prompt-free: no new package, no new
dependency, testable offline. An interactive wizard (target picker,
`Root Directory` confirm) can come later — when it does, it belongs in a
shared `@swelte/cli` only if 2+ commands need it, not preemptively.
