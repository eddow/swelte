
## Beyond SvelteKit (where Swelte can win)

SvelteKit couldn't / didn't:

1. **Cron → jobs**: DONE + hardened (`@swelte/plus/jobs`, single scheduler
   thread — one `spawn swelte_cron_run()`, sleeps to the nearest deadline
   (idle = zero CPU), missed ticks coalesce (with a `status=catchup` console
   notice when lag >= 2 intervals), no CLI/no SSH, starts at boot in the
   container. `jobsPlugin` claims `attrs: ['cron']`; core stays
   plugin-agnostic via `extraAttrs`). Retry: `@[cron('5m,retry=3')]`
   (`retry=1..5`, fallible `!void` only, blocking 5s-linear backoff in the
   tick's arm); outcomes to the console (`[swelte:cron] tick=<name>
   status=retry|dead|ok|error|catchup`). Next: persistent tick log,
   cross-restart catchup.
2. **Embedded SQLite/KV**: not started. `src/lib/backend/db.v` helper +
   `swelte migrate` > SvelteKit needing Neon/PlanetScale.
3. **First-class `@[ws]`**: not started. SvelteKit has no WS primitive. V
   `veb` + Svelte runes = typed socket Rooms/broadcast to pair with
   existing `@[sse]` list/emit modes.
4. **SSE broadcast channels**: per-request list/emit lives in core (parity).
   Cross-request `emit('room', msg)` not started — re-add only with real
   V emission behind it.
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
