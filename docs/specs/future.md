
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
2. **Embedded SQLite/KV**: DONE (`@swelte/plus/db`, single SQLite file —
   WAL, `SWELTE_DB_PATH` else `data/app.db`). `swelte migrate`
   (via `SWELTE_PLUGINS=@swelte/plus/db`) scaffolds `src/lib/backend/db.v`
   (shared conn + `kv_get/kv_set/kv_del`) + `db/migrations/001_swelte_kv.sql`,
   applies pendings in order (tracked in `_swelte_migrations`, idempotent).
   V lesson: DDL/DML need `exec_none` (`exec` only steps row queries).
   Next: KV-backed SSE rooms / SWR regen / outbox queue.
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
8. **Hardening as config**: DONE — `BODY_LIMIT/RATE_LIMIT/HANDLER_TIMEOUT` global env knobs + per-route `export const limits = {rate, rateWindowMs, timeoutMs, bodyLimit}` (`swelte_route_limits()` table, longest-prefix match, `limited` E2E fixture).
9. **Agent-native**: `swelte check --format json` + MCP + contract snapshot already ahead. Next: `swelte studio` (route graph UI from `list_routes`) + `explain_bytecode_error` for prod traces.

## Suggested order

1. #8 Hardening as config — DONE (global + per-route `limits` shipped, close it).
2. #2 Embedded SQLite/KV — DONE (unlocks everything below; KV is the primitive).
3. #4 SSE broadcast (`emit(room, msg)`) — small delta, completes SSE story on #2 pubsub.
4. #3 First-class `@[ws]` — builds on #4 broadcast infra, SvelteKit has no primitive.
5. #5 SWR background regen — reuses cron timer + atomic `dist/*.html` swap.
6. #7 Offline outbox — needs SW + #2 replay queue.
7. #6 V-native image pipeline — heavy, isolated, late.
8. #9 `swelte studio` — parallel agent-track, any time after #2.
