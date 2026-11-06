
## Beyond SvelteKit (where Swelte can win)

SvelteKit couldn't / didn't:

5. **ISR → SWR background regen**: today headers-only
   (`s-maxage+X-Swelte-Revalidate`) in core (parity). Background regen
   (re-render on timer + atomic `dist/*.html` swap) not started — the `swr`
   skeleton (empty plugin) was removed; re-add when it has a real regen
   loop behind it.
6. **V-native image pipeline**: not started. `enhanced-img` equivalent at
   `build` time (resize/WebP in V, no Sharp).
7. **Offline outbox**: core SW stays network-first for API (parity). Replay
   queue not started — the `outbox` skeleton (key helpers only, no SW
   snippet) was removed; re-add when background-sync + replay land.
8. **Agent-native**: `swelte check --format json` + MCP + contract snapshot already ahead. Next: mcp `list_routes` + `explain_bytecode_error` for prod traces.
9. `$page` can't work here, and I verified it the hard way. I tried it, and it 500s every SSR render:

- In the QJS SSR bundle, **every** `@swelte/core` import is rewritten to a render-time throw-stub by `stubSdkImports` (`engine/ssr-qjs/src/ssr.ts`). The something-example even documents this: *"only `@swelte/core` store values ($page/$navigating/$updated) and router fns need the browser gate (throw-stubs in QJS)"*.
- `$page.url` compiles to a **call** on that stub, so the sync `renderRoute` throws `page() called during SSR render` → Hand falls back to the 500 page. I confirmed via the built `dist/ssr/render.js`: `renderRoute('/guide/rpc')` returned the 279-byte 500 shell with `$page`, versus 9150 bytes of real content without it.
- Gating the *read* behind `{#if browser}` doesn't help either — the subscription is compiled into the component setup and still executes during SSR. The only sanctioned pattern (per `examples/something/.../router/+page.svelte`) is putting `$page`/`$navigating` reads behind the `browser` gate *and* never subscribing during SSR, which a layout-level nav can't do — it must render its links on the server.

So I kept the equivalent behavior without the store: `+route.svelte` now tracks a client-only `currentPath = $state('')` seeded from `window.location.pathname` in `onMount` (a server noop, so SSR renders with no active link and hydration fills it in), kept current via `popstate` + a delegated same-document click listener (deferred with `queueMicrotask` so the client router's `pushState` lands first), and applies DaisyUI's `menu-active` class plus `aria-current="page"`:

```svelte
{@const isActive = link.href !== '' && currentPath === link.href}
<li><a href={link.href} class={isActive ? 'menu-active' : ''} aria-current={isActive ? 'page' : undefined}>{link.label}</a></li>
```

`npm run build:local` passes and `renderRoute` returns full bodies again (`/` 7860, `/install` 8771, `/guide/rpc` 9150, `/plus/jobs` 18522 bytes — no 500s).

That'd be an engine change: the SSR shim would need a real (non-throwing) `page` value per request, e.g. resolving it from the request path in `swelte_page_props()` instead of stubbing it.
(note: should update examples/docs-site/src/routes/+route.svelte)