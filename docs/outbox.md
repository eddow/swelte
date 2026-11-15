# Offline mutation outbox

The service worker can persist explicitly queued mutations in IndexedDB and
replay them through Background Sync. Enable it with an endpoint allowlist:

```js
export default {
  swelte: {
    serviceWorker: {
      enabled: true,
      outbox: { paths: ['/api/save'], maxAttempts: 5, maxAgeMs: 86400000 }
    }
  }
}
```

Prefixes match whole path segments, relative to `swelte.base`, on the worker's
origin. Only POST, PUT, PATCH and DELETE are supported. Ordinary fetch/RPC
failures remain failures; requests enter the queue only through `enqueueOffline`.

```ts
import { enqueueOffline, flushOutbox, listOutbox, retryOutbox, discardOutbox } from '@swelte/core'

const id = await enqueueOffline('/api/save', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Draft' })
})
await flushOutbox()
const pending = await listOutbox()
```

A controlling worker is required. Enqueue resolves only after the IndexedDB
transaction commits, and returns a stable UUID. The worker sends that UUID as
`Idempotency-Key` on every attempt, including manual retries. The endpoint must
deduplicate it: a response can be lost after the server commits a mutation.
Delivery is at least once, not an exactly-once transaction with the server.

Requests preserve their URL, method, headers and body (up to 1 MiB; at most 1000
records). Credentials default to `omit`; explicitly set `credentials:
'same-origin'` to replay with the current cookies. Authorization headers supplied
by the caller are persisted. Apps using authenticated queues must clear their
entries when the user signs out or switches account; the framework does not infer
application identity. `listOutbox` returns metadata, excluding bodies and headers.

Replay is sequential. A lease in IndexedDB prevents overlapping workers from
claiming the same request; a stopped worker's lease expires after 60 seconds.
Attempts are recorded before sending, with a 30-second request timeout. A 2xx
acknowledgement deletes the record. Network errors, 408, 425, 429 and 5xx retry
with exponential delay (1 second to 1 hour); `Retry-After` can extend that delay
up to 24 hours. Other statuses, redirects, age expiry and exhausted attempts
retain a `failed` record. A pending retry holds later queued work until eligible;
failed records do not block it.

Defaults are five attempts and 24 hours. Configurable bounds are 1–20 attempts
and 1 second–30 days. Background Sync schedules retries where supported. The SDK
also flushes on `online` after its first use; call `flushOutbox()` on app startup
or provide a retry control for browsers without Background Sync. It resolves to
`true` while retryable work remains, `false` when only failed or no entries remain.

`retryOutbox(id)` resets the attempt/age budget while keeping the idempotency key;
`discardOutbox(id)` explicitly removes a record. Listen for
`navigator.serviceWorker` messages of type `swelte:outbox:changed` to refresh UI.
The database is scoped by worker registration and survives worker upgrades and
restarts. Browser storage removal, quota failures or eviction remain browser-owned.
The native/browser fixture covers restart, replay, preserved bodies, retries,
permanent failures and explicit discard (`node scripts/test-dogfood.mjs --browser`).
