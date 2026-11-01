# Types: V → TS projection

The Vite plugin (`@swelte/core/vite`, `swelte()` in `vite.config.ts`)
reads `.v` files as text and writes `.swelte/types/**` (`routes/`,
`lib/`) plus `.swelte/generated/**` runtime stubs and one
`.swelte/v-shim.d.ts` (`declare module '*.v'`). V never emits TS;
`tsc` never reads V.

## When

`configResolved` (dev start) + `buildStart`, re-run on `.v`
add/change/unlink. Warnings (`unknown` types, orphans,
`#lib/backend` misuse, stray `@[get/post]` in `#lib/`) go to
console, never fail correct V programs. Errors (one-default-per-verb,
unique qualifiers, folder-root double claim, `@[before]`/`@[after]`
outside `+route.v`) fail the build with file+line.

## What

`parseVFile` extracts `@[rpc|get|post|put|delete|patch|sse|before|after] pub fn name(params) ret`
(verb attributes take an optional `('qualifier')`; `@[sse]` is GET+`Accept: text/event-stream`, same qualifier rules) +
`parseStructs` extracts `pub struct` fields. `@[rpc]` fns keep the
single-args-struct rule (fn taking one struct param expands to that
struct's fields, projected inline as an anonymous literal —
`Parameters<typeof fn>[0]`-retrievable, no named import needed; the
args struct is V-side only, not re-exported to TS); verb handlers
take the framework `Request` (exact shape with the dispatcher) or narrow params (`(name string, age int)` → inline literal
with `number` coercion server-side); `@[before]`/`@[after]`
middleware (`+route.v` only) exports no callables to TS —
but the wrapper's `pub struct`s are still projected (wrapper is
+layout-shaped, shared types flow to `+page.svelte`).
`routeFor` (`src/routes/<p>.v` → `/<p>`, `src/lib/**` → no route) is
shared with the V dispatcher. `@[sse]` fns project as
`AsyncGenerator<string>` (veb streaming, either
shape); neither shape nor a mix is a build error — the emit param is
harness-injected, never client-supplied. Dynamic file segments (`[id]`,
`[...rest]`) pass through into the route pattern; `SwelteRequest`
carries a `params: Record<string, string>` field alongside
`query`/`form`/`files`/headers. `files: Record<string, string>`
holds uploaded filenames per field (`;`-joined on multi); only the
filenames are kept — multipart bytes are parsed then discarded
(dispatch-time only, never projected as args). Stubs send `File`/`Blob`
args as `multipart/form-data` (browser-set boundary); plain values stay
urlencoded.

```v
pub struct LoginArgs { pub: payload string }
pub struct Session { pub: id string ... }
@[rpc] pub fn login(args LoginArgs) !Session { ... }
```

generates `.swelte/types/routes/api/greet.d.ts`:

```ts
export interface Session { id: string; user: string; remember: boolean; expires_at: number; }
export type LoginResult = Session; // !T: may reject with SwelteRpcError
export function login(args: { payload: string }): Promise<LoginResult>; // V LoginArgs
type A = Parameters<typeof login>[0]; // { payload: string }
```

Consumed per-importer (no `sdk.*`, no `$types`):

```svelte
<script lang="ts">
  import { login } from '#routes/api/greet.v';
  import type { Session } from '#routes/api/greet.v';
  const s: Session = await login({ payload: name });
  type LoginA = Parameters<typeof login>[0]; // { payload: string }
</script>
```

`import type ... from '#lib/x.v'` works identically (struct in,
struct out, always `await`).

## Type table

`string→string`, `bool→boolean`, ints/floats→`number`,
`[]T→T[]`, `[]u8→string` (base64), `map[string]T→Record<string,unknown>`
(value type stays opaque — `T` does not cross the TS boundary),
`time.Time→number` (unix epoch, `json.encode` as-is — decided 2026-10-29),
`?T→T|null`, `!T` strips to `T` + fallible flag,
named `UpperCamel` structs pass through 1:1, else `unknown` + warning.

No drift: the wire and the projection agree (unix int both sides).
