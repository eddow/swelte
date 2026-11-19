# Deploy setup: `swelte deploy` (config automater, setup only)

Swelte's deploy model is **prebuilt**: `npm run build` (linux/amd64 from
the `package.json` declaration) produces `dist/` + `dist/server` (single
artifact), then the platform CLI uploads (`vercel deploy`). `npm run
build:local` forces host-native for local preview (`swelte preview`).
`swelte deploy` generates the wrapper files that model needs — it never
ships anything itself (no creds, no subprocess to `vercel`/`docker`,
no network).

## `swelte deploy init [--target vercel|docker]` (default: `vercel`)

Generates (compare-then-write, re-runnable), patches `package.json`'s
`swelte.targetOs/targetArch`, and refreshes the managed
`<!-- swelte:deploy -->` block in `README.md`:

| File | `vercel` | `docker` |
|---|---|---|
| `Dockerfile[.vercel]` | `Dockerfile.vercel` | `Dockerfile` |
| `.dockerignore` | `*` + allowlist `dist/` + Dockerfile | same |
| `.vercelignore` | allowlist `dist/` + Dockerfile + `package.json` | — |
| `README.md` | recipe → `npm run build` + `vercel deploy`, markers delimit the managed region | recipe → `docker build/run` |
| `package.json` | `swelte.targetOs/targetArch → linux/amd64` (only when unset; `--force` overwrites). Scripts untouched | same |

Two builds, one artifact (kept, never touched):

- **`build`** (`swelte build`) — deploy target when the declaration exists,
  else this machine.
- **`build:local`** (`swelte build --local`) — always this machine,
  feeds `swelte preview` (which only runs host-native output).

No `build:deploy`: it was a redundant third alias for `build`. No
`preview:deploy`: the ship commands (`vercel deploy --prod`,
`docker build -t …`) are one-liners documented in the Dockerfile + README
recipes, not scripts.

Detection (never prompted):

- **SSR**: `@swelte/ssr-qjs` in deps → `SWELTE_SSR=1`, else SPA-only.
- **`distDir`**: from `svelte.config.js` (`loadConfig`), default `dist`.
- **Root Directory hint**: monorepo-relative path in the Dockerfile comment.

```
swelte deploy init --target vercel   # Dockerfile.vercel + .dockerignore + .vercelignore
swelte deploy init --target docker   # Dockerfile + .dockerignore
swelte deploy --target docker --dockerfile Dockerfile.prod --dry-run
swelte deploy init --target vercel --force   # overwrite an existing non-linux targetOs
```

Dockerfile naming rule: **`Dockerfile.vercel` only for `--target vercel`**
(Vercel picks the Dockerfile path from project settings; the `.vercel`
suffix keeps it distinct in repos that also ship a generic `Dockerfile`).
Every other target uses plain `Dockerfile` (overridable with `--dockerfile`).

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

P0 (built): `vercel` + `docker` — the exact `examples/docs-site` setup,
dogfooded (`swelte deploy status` is green on it). Phased, error clearly
today: `fly` / `railway` / `static` (static already has `swelte build
--target static` → `dist/.swelte-static`; no Dockerfile needed).

## `@clack/prompts`: no new `@swelte/cli` package

`deploy init` is **fully flag-driven, no prompts** (defaults: vercel,
`Dockerfile.vercel`, linux/amd64) — same contract as `npm create @swelte
--yes` (non-interactive). `@clack/prompts` stays where it is (`@swelte/create`
only, a runtime dep there). Core stays prompt-free: no new package, no new
dependency, testable offline. An interactive wizard (target picker,
`Root Directory` confirm) can come later — when it does, it belongs in a
shared `@swelte/cli` only if 2+ commands need it, not preemptively.
