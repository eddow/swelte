
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
9. **Request-local SSR page state**: the docs-site dogfood exposed SSR store
   throw-stubs and required a browser-only active-navigation workaround. EMV
   needs state during SSR itself. Shared work and acceptance now live in
   [dogfood-roadmap.md](dogfood-roadmap.md), DF-02, DF-05 and DF-06. Revisit
   `examples/docs-site/src/routes/+route.svelte` when that contract is delivered;
   its workaround is not a completed framework solution.
