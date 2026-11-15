# Framework follow-up status

All items in this batch are implemented. Their public contracts and limits live
in the user documentation:

- **Background ISR regeneration:** public native page cache, stale reads,
  background rendering and atomic replacement; failed regeneration retains the
  previous HTML. See [configuration](../config.md).
- **Native image processing:** host-side V resizing and WebP encoding, generated
  metadata and published assets. See [images](../images.md).
- **Offline outbox:** explicit IndexedDB mutation queue, Background Sync,
  persistent retries and retained failures. See [outbox](../outbox.md).
- **Durable scheduled jobs:** SQLite schedule persistence, coalesced restart
  catchup and coordination across processes sharing the scheduler file.
  See [durable schedules](../plus.md#durable-schedules).

SSR source guard precision and nested error boundaries were delivered earlier;
see [SSR](../ssr.md). These capabilities remain independent of the completed
[dogfood work](dogfood-roadmap.md).

Regression coverage includes the core, SSR and Plus unit suites,
`npm run test:images`, `npm run test:jobs`, and
`node scripts/test-dogfood.mjs --browser`.
