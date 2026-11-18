# Swelte libraries: `src/lib` (published) + `src/routes` (dogfood)

A Swelte library is shaped like a SvelteKit library with a V blend.
One layout covers both authoring and consumption:

```text
my-lib/
  package.json          # files + exports + swelte.v.exports (see below)
  svelte.config.js      # same defineConfig shape as apps
  vite.config.ts
  src/
    lib/                # THE public surface — published, consumed by apps
      Panel.svelte      # Svelte components (SvelteKit-style lib)
      state.svelte.ts   # runes / TS helpers
      text/api.v        # isomorphic V (universal) — published from here
      secrets/api.v     # server-only V (backend/ or *_backend.v)
    routes/             # dogfood / demo / test ONLY — never published
      +page.svelte      # local demo harness
      +page.v           # exercises the lib like a consumer would
  dist/                 # svelte-package output (JS/Svelte side only)
```

## Rule 1: `src/lib` is the published surface; `src/routes` is local dogfood

| dir | published? | routed in consumers? | purpose |
|---|---|---|---|
| `src/lib/**` | **yes** | never | Svelte components + TS + V modules apps import |
| `src/routes/**` | **no** | never | author-owned demo/test/dogfood; `swelte dev/build/test` runs here |

URL ownership, middleware (`+route.v` `@[before]`/`@[after]`), and `@[load]`
stay in the consuming application. A library's `src/routes` exists so the
author can run the library exactly like an app (`swelte dev`, `swelte build`,
`swelte test`) — it must never leak URL claims or API surface into consumers.
`swelte check` warns on a library whose `package.json#files` would include
`src/routes` (as `lib-routes-leak` under `--lib`); the `build:lib` script
below excludes it by construction.

This mirrors SvelteKit: `src/lib` ships, `src/routes` in a library repo is the
playground. The `#lib` / `#routes` aliases keep their app meaning inside the
library repo (author dogfoods `#lib/...` locally, demos through `#routes/...`);
consumers never resolve the library's `#routes`.

## Rule 2: Svelte side — standard `svelte-package` conventions

The JS/Svelte side follows SvelteKit library conventions, not a Swelte
invention:

- Author in `src/lib/`. Run `svelte-package` (from `@sveltejs/package`) to
  emit `dist/` (compiled JS + `.d.ts`, Svelte preserved as source).
- `package.json` carries `"svelte": "./dist/index.js"`, a
  `"./package.json": "./package.json"` passthrough, and per-file
  `exports` (`"."` + `"./<path>"` for each public Svelte/TS entry).
- `files` includes `dist` (built output). It never includes `src/routes`.

The `"build:lib"` script (`npm create @swelte --lib` scaffolds it) is the ad-hoc
equivalent of the app's `"build": "swelte build"` — same command shape,
different target:

```json
{
  "scripts": {
    "build": "swelte build",
    "build:lib": "svelte-package && swelte check --lib"
  }
}
```

Apps keep `"build": "swelte build"`. Libraries keep both: `"build"` runs the
local dogfood app (`src/routes` demo, exactly like an app build — proves the
lib works), `"build:lib"` publishes (`svelte-package` for the Svelte/TS half,
`swelte check --lib` for the V/packaging half).

`svelte-package` handles the Svelte/TS half; `swelte check --lib` validates
the library schema without side effects (same diagnostics engine as
`swelte check`):

- `swelte.v.exports`: every `source`/`entry` inside the package, each `entry`
  inside its `source`, module-leaf match on root files;
- `exports` covers each public Svelte/TS entry plus the `./package.json`
  passthrough; each `./v/*.v` TS specifier resolves to a declared export;
- `files` includes the Svelte output (`dist`) and the V sources under
  `src/lib/**/*.v`, and excludes `src/routes` (warn when the packed set
  would leak dogfood).

## Rule 3: V side — `src/lib/**/*.v` published as raw sources

V is compiled on the consumer side (native link + optional WASM), so V
sources ship raw from `src/lib` — there is no V "dist". Each public V module
is declared in `package.json#swelte.v.exports`:

```json
{
  "files": ["dist", "src/lib/**/*.v"],
  "exports": {
    ".": { "svelte": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./package.json": "./package.json",
    "./v/text.v": { "types": "./.swelte/types/npm/text.d.ts" }
  },
  "swelte": {
    "v": {
      "exports": {
        "./text.v": { "source": "./src/lib/text", "entry": "./src/lib/text/api.v", "target": "universal" },
        "./secrets.v": { "source": "./src/lib/secrets", "entry": "./src/lib/secrets/api.v", "target": "server" }
      }
    }
  }
}
```

Field semantics (unchanged from `npm-v-libraries.md`):

- `source`: complete V module directory under `src/lib` — every `.v` below
  it is staged, subdirectories preserved.
- `entry`: the `.v` file whose `@[rpc]` functions form the TS/WASM public
  API. Must be inside `source`.
- `target`: `universal` (browser WASM + native, default) or `server`
  (native only, never importable from TS/Svelte).

Consumers import TS via the npm specifier and V via the deterministic
namespace — identical to app-local semantics, one directory over:

```ts
import { normalize } from 'my-lib/v/text.v'
```

```v
import npm_my_lib.text
```

`backend/` segments (any depth under `src/lib`) or `*_backend.v` files are
backend-only: resolvable from `#routes` V-to-V includes at codegen time,
rejected from browser/TS imports with a build error — same rule as apps
(`rpc.md`).

Isomorphism to standard SvelteKit libs: `src/lib` is published (here both
built `dist/` for JS/Svelte and raw `src/lib/**/*.v` for V) while
`src/routes` stays the local dogfood/test/demo playground.

## Roadmap

1. ~~`swelte-lib-pack` subcommand~~ `swelte check --lib` flag: DONE —
   library-schema validation (export/source/entry checks via the shared
   validator + `exports`/`files` coverage + no-`src/routes`-leak), no side
   effects.
2. ~~scaffolder asks app-vs-lib~~ DONE — `npm create @swelte` interactive
   kind pick (`--lib` / `--kind lib` / `--template lib` skip it),
   `templates/lib/` overlay, `build` + `build:lib` scripts
   (`docs/cli.md#swelte-init-deprecated`).
3. DONE — `fixtures/dogfood/sample-lib` uses `src/lib` + author-only `src/routes`.
   The dogfood script builds with `svelte-package`, checks the library schema,
   packs/installs the tarball and asserts no `src/routes` files were published.
