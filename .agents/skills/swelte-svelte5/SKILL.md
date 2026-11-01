---
name: swelte-svelte5
description: Write Swelte frontend components in Svelte 5 runes style — $state/$props/$derived, snippets, event handlers, stub calls. Use when creating or fixing .svelte files, fixing legacy syntax, or wiring #routes/#lib imports.
---

# Swelte Svelte 5

Svelte 5 runes only. Never legacy Svelte 3/4 syntax (`export let`, `$:` labels, `on:click`, `<slot>`).

## Imports

```svelte
<script lang="ts">
  import { get_greeting } from '#routes/+page.v'
  import type { GetGreetingResult } from '#routes/+page.v'
  import { hash_string } from '#lib/crypto/hash.v'
  import { SwelteRpcError } from '@swelte/core'

  let name = $state('world')
  let greeting: GetGreetingResult = $state('')
  let lastError = $state('')

  async function loadGreeting() {
    lastError = ''
    try {
      greeting = await get_greeting({ payload: name })
    } catch (e) {
      if (e instanceof SwelteRpcError) lastError = e.message
      else lastError = String(e)
    }
  }
</script>

<main>
  <input bind:value={name} placeholder="your name" />
  <button onclick={loadGreeting}>Greet</button>
  {#if greeting}<p>{greeting}</p>{/if}
  {#if lastError}<pre>{lastError}</pre>{/if}
</main>
```

- `#routes/...` = server fetch. `#lib/...` = local WASM call (always `await`).
- `import type { Session } from '#routes/api/greet.v'` for structs; args types via `Parameters<typeof login>[0]`.
- SSE stubs are `AsyncGenerator<string>`: `for await (const t of tick_stream({ n: '3' })) { ... }`.
- `File`/`Blob` stub args send `multipart/form-data` automatically; plain values stay urlencoded (verbs) or JSON (`@[rpc]`).

## Runes rules

- State: `let x = $state(...)`. Props: `let { status = 500 }: {...} = $props()`. Derived: `let y = $derived(...)`.
- Events: `onclick={handler}`, not `on:click`.
- Composition: `{@render children()}` + snippets, not `<slot />`.
- Dynamic segments: client stubs interpolate `params` into the URL and strip them from the payload — pass them as ordinary args.

## SSR component rule (build-enforced)

SDK imports (`#routes/*`, `#lib/*`, `loadPage`) are allowed in `.svelte` files — interaction handlers (`onclick`, `onMount`, plain functions) keep working after hydration. But a stub **called at component top level** fires during SSR render (no fetch in QuickJS) → build error naming the stub. Move load-time data into `$props()` (supplied by `@[load]` via `Hand`); keep the stub for handlers. Top-level `await` is rejected by the Svelte compiler in both modes.

Also rejected in SSR-compiled components: `node:` imports, `fetch(`, top-level `await`.

## `+error.svelte` contract

Single global `src/routes/+error.svelte`, props `{ status?: number; message?: string }`. Same file renders server-side and client-side (via `loadPage()` mapping `SwelteRpcError` → `{ error: { status, message } }`). No per-directory inheritance — by design, not a gap.

## Sources

Stable — no spec dependency for the above:

- `docs/example.md` — canonical component patterns
- `docs/ssr.md` — SSR component rule, `+error` contract

## Spec dependency

⚠️ This skill MUST be updated when these specs land:

- `docs/specs/sveltekit.md` P2 (client router: `goto()`, `invalidate()`, `beforeNavigate`, `$app/navigation|stores|state`, streaming `<await>`, `use:enhance` cycle) — navigation and data-refresh patterns change fundamentally once a client router exists. (`#app/forms`-lite `deserialize` is DONE — see `docs/forms.md`; the remaining form gap is only the `use:enhance` cycle.)
