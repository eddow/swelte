
## Beyond SvelteKit (where Swelte can win)

SvelteKit couldn't / didn't:

1. **Cron → jobs**: DONE (extracted to `@swelte/plus/jobs`, single scheduler
   thread — one `spawn swelte_cron_run()`, sleeps to the nearest deadline
   (idle = zero CPU), missed ticks coalesce, no CLI/no SSH, starts at boot
   in the container. `jobsPlugin` claims `attrs: ['cron']`; core stays
   plugin-agnostic via `extraAttrs`). Next: persistent tick log, missed-tick
   catchup, `retry(n)` + dead-letter.
2. **Embedded SQLite/KV**: not started. `src/lib/backend/db.v` helper +
   `swelte migrate` > SvelteKit needing Neon/PlanetScale.
3. **First-class `@[ws]`**: not started. SvelteKit has no WS primitive. V
   `veb` + Svelte runes = typed socket Rooms/broadcast to pair with
   existing `@[sse]` list/emit modes.
4. **SSE broadcast primitive**: SSE stays in core (per-request list/emit is
   SvelteKit parity, not beyond). Channels (`emit('room', msg)`) not
   started — the `sse-channels` skeleton (helpers only, no emission) was
   removed; re-add when it has real V emission behind it.
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
8. **Hardening as config**: `BODY_LIMIT/RATE_LIMIT/HANDLER_TIMEOUT` already built-in (SvelteKit needs middleware). Expose per-route: `export const limits = {rate, timeout}`.
9. **Agent-native**: `swelte check --format json` + MCP + contract snapshot already ahead. Next: `swelte studio` (route graph UI from `list_routes`) + `explain_bytecode_error` for prod traces.

## Suggested order
