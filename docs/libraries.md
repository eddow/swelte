# One Swelte project, two build targets

Every Swelte project can build an application and a reusable package. There is
no app/library project kind and no kind question in `npm create @swelte`.

```sh
swelte dev       # develop the local application/demo
swelte build     # application: routes + their dependencies -> dist/
swelte package   # library: src/lib -> package/, with publication validation
```

| Directory | Application build | Library build |
|---|---|---|
| `src/routes` | Application URLs, middleware and page loads | Excluded |
| `src/lib` | Shared application code | Reusable package sources |
| `dist` | Server binary and static application assets | Excluded from publication |
| `package` | Separate from application output | Built JS, Svelte and declarations |

Routes may serve an application or a package's demo/test harness. They never
claim URLs in a consumer. A project with only `src/lib` can run `swelte package`
without routes, an application entry point, a server build or a V compiler.

## Scaffolding and scripts

The empty and sample starters share one project shape. Every starter includes:

```json
{
  "private": true,
  "scripts": {
    "build": "swelte build",
    "package": "swelte package"
  },
  "files": ["package", "src/lib/**/*.v"],
  "exports": {
    ".": {
      "types": "./package/index.d.ts",
      "svelte": "./package/index.js",
      "default": "./package/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

Export supported components/helpers from `src/lib/index.ts` or add explicit
subpath exports. Building does not publish anything; remove `private: true`
when you intend to publish to npm. Public exports are an explicit API decision.
The legacy `--lib` / `--kind lib` flags select the `--template lib` reusable-V
sample; they do not create a different project type.

## Packaging

`swelte package` wraps `@sveltejs/package`'s build core with Swelte-owned paths:
Svelte/TS becomes JS, preserved Svelte source and declarations in `package/`;
scratch output lives in `.swelte/package/`. It does not invoke the standalone
`svelte-package` CLI, build routes, or build native/WASM application artifacts.

The command validates publication metadata before writing output and fails on
`lib-*` diagnostics: declared V exports must resolve, `exports` must cover V
entries and the package.json passthrough, and `files` must include the library
output and V sources while excluding routes. Pure Svelte/TS packages need no
`swelte.v.exports`. `swelte check --lib` remains a read-only diagnostic command.

`--input` overrides `src/lib`; otherwise the configured `swelte.libDir` is used.
`--output` overrides `package/`; update `files`, `exports` and `svelte` to match.
The output must stay separate from source, generated files and application
output. Existing projects should move library export paths from `dist/` to
`package/`, narrow `files` accordingly, and replace
`swelte package && swelte check --lib` with `swelte package`.

## V modules — `src/lib/**/*.v` published as raw sources

V is compiled on the consumer side (native link + optional WASM), so V
sources ship raw from `src/lib` — there is no precompiled V output. Each public V module
is declared in `package.json#swelte.v.exports`:

```json
{
  "files": ["package", "src/lib/**/*.v"],
  "exports": {
    ".": { "svelte": "./package/index.js", "types": "./package/index.d.ts" },
    "./package.json": "./package.json",
    "./v/text.v": { "types": "./package/text.d.ts" }
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

### Plus plugins and `src/lib/backend/db.v`

The embedded SQLite/KV helper is Plus-owned, not a core builtin. Register
the `db` plugin explicitly in `vite.config.ts` (`@swelte/plus` §3 box 2):

```ts
import { dbPlugin, jobsPlugin } from '@swelte/plus';
import { swelte } from '@swelte/core/vite';

export default defineConfig({
  plugins: [svelte(svelteConfig), swelte({ plugins: [jobsPlugin, dbPlugin] })],
});
```

`swelte migrate` (resolved from the configured `plugins: [dbPlugin]` entry,
`@swelte/plus/db`) scaffolds `src/lib/backend/db.v` + `db/migrations/*.sql`
and stages `backend/db.v` into `.swelte/` whenever the plugin is registered.
Core alone stages nothing here — remove the plugin and the staged file
prunes. See `plus.md` and `cli.md` (`swelte migrate`).

The same project layout applies to every Swelte project: `src/lib` is published (here both
built `package/` for JS/Svelte and raw `src/lib/**/*.v` for V) while
`src/routes` stays the local dogfood/test/demo playground.
