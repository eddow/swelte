# Types: V → TS projection

The Vite plugin (`@swelte/core/vite`, `swelte()` in `vite.config.ts`)
reads `.v` files as text and writes `.swelte/types/**` (`routes/`,
`lib/`) plus `.swelte/generated/**` runtime stubs and one
`.swelte/v-shim.d.ts` (`declare module '*.v'`). V never emits TS;
`tsc` never reads V.

## When

`configResolved` (dev start) + `buildStart`, re-run on `.v`
add/change/unlink. Warnings (`unknown` types, orphans, leaf/index
clashes, `#lib/backend` misuse, stray `@[get/post]` in `#lib/`) go to
console, never fail correct V programs.

## What

`parseVFile` extracts `@[rpc|get|post|put|delete|patch] pub fn name(params) ret`
(verb attributes take an optional `('qualifier')`) +
`parseStructs` extracts `pub struct` fields. `@[rpc]` fns keep the
single-args-struct rule (fn taking one struct param expands to that
struct's fields in TS); verb handlers take the framework `Request`
(shape with the dispatcher, roadmap item 1).
`routeFor` (`src/routes/<p>.v` → `/<p>`, `src/lib/**` → no route) is
shared with the V dispatcher.

```v
pub struct LoginArgs { pub: payload string }
pub struct Session { pub: id string ... }
@[rpc] pub fn login(args LoginArgs) !Session { ... }
```

generates `.swelte/types/routes/api/greet.d.ts`:

```ts
export interface LoginArgs { payload: string; }
export interface Session { id: string; user: string; remember: boolean; expires_at: number; }
export type LoginResult = Session; // !T: may reject with SwelteRpcError
```

Consumed per-importer (no `sdk.*`, no `$types`):

```svelte
<script lang="ts">
  import { login } from '#routes/api/greet.v';
  import type { LoginArgs, Session } from '#routes/api/greet.v';
  const args: LoginArgs = { payload: name };
  const s: Session = await login(args);
</script>
```

`import type ... from '#lib/x.v'` works identically (struct in,
struct out, always `await`).

## Type table

`string→string`, `bool→boolean`, ints/floats→`number`,
`[]T→T[]`, `[]u8→string` (base64), `map[string]T→Record<string,T>`,
`time.Time→number` (unix epoch, `json.encode` as-is — decided 2026-10-29),
`?T→T|null`, `!T` strips to `T` + fallible flag,
named `UpperCamel` structs pass through 1:1, else `unknown` + warning.

No drift: the wire and the projection agree (unix int both sides).
