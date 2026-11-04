
## Beyond SvelteKit (where Swelte can win)

SvelteKit couldn't / didn't:

1. **Cron → jobs**: today best-effort `spawn+sleep`, no watchdog, single-instance. Next: persistent tick log, missed-tick catchup, `retry(n)` + dead-letter, `swelte jobs list`.
2. **Embedded SQLite/KV**: V binary + volume = zero-ops DB. `src/lib/backend/db.v` helper + `swelte migrate` > SvelteKit needing Neon/PlanetScale.
3. **First-class `@[ws]`**: SvelteKit has no WS primitive. V `veb` + Svelte runes = typed socket Rooms/broadcast to pair with existing `@[sse]` list/emit modes.
4. **SSE broadcast primitive**: add channels (`emit('room', msg)`) — currently per-request emit only.
5. **ISR → SWR background regen**: today headers-only (`s-maxage+X-Swelte-Revalidate`). V can re-render on timer + swap `dist/*.html` atomically.
6. **V-native image pipeline**: `enhanced-img` equivalent at `build` time (resize/WebP in V, no Sharp).
7. **Offline outbox**: SW currently network-only for API. Add background-sync queue (`POST` while offline → replay) — LiveView can't, SvelteKit doesn't.
8. **Hardening as config**: `BODY_LIMIT/RATE_LIMIT/HANDLER_TIMEOUT` already built-in (SvelteKit needs middleware). Expose per-route: `export const limits = {rate, timeout}`.
9. **Agent-native**: `swelte check --format json` + MCP + contract snapshot already ahead. Next: `swelte studio` (route graph UI from `list_routes`) + `explain_bytecode_error` for prod traces.

## Suggested order