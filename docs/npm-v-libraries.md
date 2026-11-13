# V libraries distributed through npm

An npm package can publish native/server or isomorphic V modules for a
Swelte application. The package remains the source of truth; Swelte
materializes declared `.v` files under `.swelte/` as generated compiler
input. Applications must never import from `node_modules` or `.swelte`
directly.

## Consumer imports

TypeScript and Svelte use the npm package name and logical V export:

```ts
import { normalize } from '@acme/validation/v/phone.v'

const value = await normalize({ input: '+40 123 456' })
```

Application V code uses the deterministic V module namespace:

```v
import npm_acme_validation.phone

value := phone.normalize(phone.NormalizeArgs{ input: '+40 123 456' })
```

An alias avoids collisions when two imported modules have the same leaf:

```v
import npm_acme_validation.phone as validation_phone

value := validation_phone.normalize(validation_phone.NormalizeArgs{ input: input })
```

The mapping is mechanical:

| npm/TS export | V module |
|---|---|
| `@acme/validation/v/phone.v` | `npm_acme_validation.phone` |
| `@acme/validation/v/text/slug.v` | `npm_acme_validation.text.slug` |
| `my-library/v/math.v` | `npm_my_library.math` |

`#lib/...` remains application-local and resolves only against `src/lib`.
V itself does not resolve npm packages: Swelte resolves the npm dependency
graph and stages each declared module before invoking V.

## Package manifest

Declare logical exports in the package's `package.json`:

```json
{
  "name": "@acme/validation",
  "version": "1.2.3",
  "files": ["vlib"],
  "swelte": {
    "v": {
      "exports": {
        "./phone.v": {
          "source": "./vlib/phone",
          "entry": "./vlib/phone/api.v",
          "target": "universal"
        },
        "./secrets.v": {
          "source": "./vlib/secrets",
          "entry": "./vlib/secrets/api.v",
          "target": "server"
        }
      }
    }
  }
}
```

Each declaration has:

- `source`: complete V module directory. Every `.v` file below it is staged,
  preserving subdirectories.
- `entry`: `.v` file whose `@[rpc]` functions form the TS/WASM public API.
  It must be inside `source`.
- `target`: `universal` (browser WASM plus native V) or `server` (native V
  only). An omitted target defaults to `universal`.

The logical export determines the V module path. Consequently, the files in
`source` must declare the export's final path component:

```v
// vlib/phone/api.v, exported as ./phone.v
module phone

pub struct NormalizeArgs {
pub:
    input string
}

@[rpc]
pub fn normalize(args NormalizeArgs) string {
    return args.input.trim_space()
}
```

For `./text/slug.v`, root files declare `module slug` and consumers import
`npm_acme_validation.text.slug`.

Files sharing that module call each other without imports. If the package
splits implementation into nested V submodules, their imports also use the
deterministic namespace (for example
`import npm_acme_validation.text.slug.rules`), because npm identity must
remain explicit across every V module boundary.

## Universal and server modules

`universal` entries expose only `@[rpc]` functions to TypeScript. They obey
the same WASM boundary and portable-import restrictions as application
`#lib/*.v` files. Swelte generates exact ambient declarations and a WASM
stub for the npm specifier. Structs appearing in that public boundary must be
declared in the entry file so signature projection and ABI generation see the
complete contract; helper implementations may live in the other module files.

`server` entries are materialized for V imports but cannot be imported from
TypeScript/Svelte. They may use native V facilities such as filesystem,
network, database, or time modules.

Packages contribute reusable modules, not application routes. URL ownership,
middleware, and `@[load]` remain in the consuming application.

Native server modules use V's existing database, HTTP and crypto facilities;
they do not need browser RPC signatures or a Swelte integration plugin for
every native library. PostgreSQL ORM/pooling integration should reuse `db.pg`
and the selected toolchain, with libpq and migration ownership documented.

`npm run test:dogfood` in the Swelte repository packs/installs a library with
server interfaces, callbacks/channels, nested V modules, native SQLite/crypto
dependencies and shared Svelte UI. It builds browser assets and serves native
JSON/QuickJS HTML with an empty runtime PATH. SQLite tests native linking only;
PostgreSQL persistence has separate acceptance. Installed UI dependencies with
Svelte-only exports, nested components and typed runes modules are bundled for
SSR; unresolved imports fail the build.

## Resolution and generated output

Swelte scans the application's dependencies, optional dependencies, and dev
dependencies. For packages with `swelte.v.exports`, it follows their runtime
dependencies transitively so package-internal npm V imports resolve, without
crawling unrelated JavaScript-only dependency trees. A scoped npm name is
converted to a valid V namespace by removing `@` and replacing punctuation
with `_`, prefixed by the reserved `npm_` marker.

For the example above, generated compiler input resembles:

```text
.swelte/
  npm_acme_validation/
    phone/
      api.v
      helpers.v
    secrets/
      api.v
  npm_v_modules.json
  types/npm/...
  generated/npm/...
```

`npm_v_modules.json` records package name, installed version, TS specifier,
V module, and target. `.swelte` remains derived and gitignored.

Generation fails when:

- a source or entry escapes its package, including through a symlink;
- an entry is outside its declared source directory;
- the source module declaration does not match the logical export;
- two package names normalize to the same V namespace;
- application code declares a module beginning with reserved `npm_`;
- browser code imports a `server` export;
- a universal export violates the WASM subset or duplicates another exported
  function name in the consolidated production WASM module.

Only installed packages in the application's npm dependency graph are
considered. Physical hoisting under `node_modules` is not part of the public
contract.

