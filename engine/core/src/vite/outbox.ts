export interface OutboxOptions {
	/** Explicit same-origin path prefixes whose mutations may be queued. */
	paths: string[]
	maxAttempts?: number
	maxAgeMs?: number
}

export function normalizeOutbox(raw: unknown): OutboxOptions | null {
	if (raw === undefined || raw === null) return null
	if (typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('serviceWorker.outbox requires an options object')
	const options = raw as OutboxOptions
	if (
		!Array.isArray(options.paths) ||
		options.paths.length === 0 ||
		options.paths.some(
			(path) =>
				typeof path !== 'string' ||
				!path.startsWith('/') ||
				path.startsWith('//') ||
				/[?#\\]/.test(path) ||
				path.split('/').some((part) => part === '.' || part === '..')
		)
	)
		throw new Error('serviceWorker.outbox.paths must contain same-origin absolute path prefixes')
	const maxAttempts = options.maxAttempts ?? 5
	const maxAgeMs = options.maxAgeMs ?? 86400000
	if (
		!Number.isInteger(maxAttempts) ||
		maxAttempts < 1 ||
		maxAttempts > 20 ||
		!Number.isSafeInteger(maxAgeMs) ||
		maxAgeMs < 1000 ||
		maxAgeMs > 30 * 86400000
	)
		throw new Error('outbox maxAttempts must be 1..20 and maxAgeMs 1000..2592000000')
	return { paths: options.paths, maxAttempts, maxAgeMs }
}

/** Only explicit messages enqueue requests. The fetch handler never replays an
 * arbitrary failed POST. The DB name survives worker/version upgrades. */
export function outboxSource(options: OutboxOptions | null): string {
	if (!options) return ''
	return `
const OUTBOX_OPTIONS = ${JSON.stringify(options)};
const OUTBOX_TAG = 'swelte-outbox';
let outboxDrain;
let outboxDb;
function openOutbox() {
  return outboxDb ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('swelte-outbox:' + self.registration.scope, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('requests', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function outboxTx(action) {
  const db = await openOutbox();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('requests', 'readwrite');
    const store = tx.objectStore('requests');
    let value;
    action(store, (result) => { value = result; });
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('outbox transaction aborted'));
  });
}
async function outboxList() {
  return outboxTx((store, done) => { const request = store.getAll(); request.onsuccess = () => done(request.result.sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))); });
}
async function outboxNotify() {
  for (const client of await self.clients.matchAll()) client.postMessage({ type: 'swelte:outbox:changed' });
}
async function outboxSync() {
  if (self.registration.sync) await self.registration.sync.register(OUTBOX_TAG);
}
async function outboxEnqueue(input) {
  const url = new URL(input.url, self.location.origin);
  const method = String(input.method || 'POST').toUpperCase();
  if (url.origin !== self.location.origin || !['POST','PUT','PATCH','DELETE'].includes(method) || !OUTBOX_OPTIONS.paths.some((path) => { const prefix = withBase(path).replace(/\\/$/, ''); return url.pathname === prefix || url.pathname.startsWith(prefix + '/'); })) throw new Error('request is outside the outbox contract');
  if (!(input.body instanceof ArrayBuffer) || input.body.byteLength > 1048576) throw new Error('outbox body must be at most 1 MiB');
  const headers = new Headers(input.headers);
  for (const name of ['cookie', 'host', 'content-length']) headers.delete(name);
  const id = crypto.randomUUID();
  headers.set('Idempotency-Key', id);
  const record = { id, url: url.href, method, headers: [...headers], body: input.body, credentials: input.credentials === 'same-origin' ? 'same-origin' : 'omit', createdAt: Date.now(), nextAttemptAt: 0, attempts: 0, state: 'pending', failure: null, leaseUntil: 0 };
  await outboxTx((store, done) => {
    const count = store.count(); count.onsuccess = () => { if (count.result >= 1000) { store.transaction.abort(); return; } store.add(record); done(id); };
  });
  await outboxSync().catch(() => {});
  await outboxNotify();
  return id;
}
async function outboxClaim() {
  return outboxTx((store, done) => {
    const all = store.getAll();
    all.onsuccess = () => {
      const records = all.result.sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      for (const record of records) {
        if (record.state === 'failed') continue;
        if (Date.now() - record.createdAt > OUTBOX_OPTIONS.maxAgeMs || record.attempts >= OUTBOX_OPTIONS.maxAttempts) {
          record.state = 'failed'; record.failure = 'expired-or-exhausted'; store.put(record); continue;
        }
        if (record.nextAttemptAt > Date.now() || record.leaseUntil > Date.now()) break;
        record.attempts++;
        record.token = crypto.randomUUID();
        record.leaseUntil = Date.now() + 60000;
        record.nextAttemptAt = Date.now() + Math.min(3600000, 1000 * 2 ** (record.attempts - 1));
        store.put(record); done(record); return;
      }
    };
  });
}
async function outboxFinish(record, result) {
  await outboxTx((store) => {
    const get = store.get(record.id);
    get.onsuccess = () => {
      const current = get.result;
      if (!current || current.token !== record.token) return;
      if (result.ok) { store.delete(record.id); return; }
      current.leaseUntil = 0;
      current.failure = result.reason;
      current.state = result.permanent || current.attempts >= OUTBOX_OPTIONS.maxAttempts ? 'failed' : 'pending';
      if (result.retryAt) current.nextAttemptAt = Math.max(current.nextAttemptAt, result.retryAt);
      store.put(current);
    };
  });
  await outboxNotify();
}
function drainOutbox() {
  return outboxDrain ||= (async () => {
    for (;;) {
      const record = await outboxClaim();
      if (!record) break;
      let result;
      try {
        const response = await fetch(record.url, { method: record.method, headers: record.headers, body: record.body, credentials: record.credentials, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        const retry = [408,425,429].includes(response.status) || response.status >= 500;
        const after = response.headers.get('Retry-After');
        let retryAt = after && /^\\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after || '');
        retryAt = Number.isFinite(retryAt) ? Math.min(Date.now() + 86400000, retryAt) : 0;
        result = { ok: response.ok, permanent: !retry, reason: 'http-' + response.status, retryAt };
      } catch { result = { ok: false, permanent: false, reason: 'network' }; }
      await outboxFinish(record, result);
      if (!result.ok && !result.permanent) break;
    }
    return (await outboxList()).some((record) => record.state !== 'failed');
  })().finally(() => { outboxDrain = null; });
}
self.addEventListener('sync', (event) => {
  if (event.tag === OUTBOX_TAG) event.waitUntil(drainOutbox().then((pending) => { if (pending) throw new Error('outbox retry pending'); }));
});
self.addEventListener('message', (event) => {
  if (!event.data?.type?.startsWith('swelte:outbox:') || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      if (!event.source?.url || new URL(event.source.url).origin !== self.location.origin) throw new Error('invalid outbox client');
      const operation = event.data.type.slice('swelte:outbox:'.length);
      let result;
      if (operation === 'enqueue') result = await outboxEnqueue(event.data.request);
      else if (operation === 'list') result = (await outboxList()).map(({ body, headers, token, ...metadata }) => metadata);
      else if (operation === 'flush') { result = await drainOutbox(); if (result) await outboxSync().catch(() => {}); }
      else if (operation === 'discard') result = await outboxTx((store) => { store.delete(event.data.id); });
      else if (operation === 'retry') {
        await outboxTx((store) => { const get = store.get(event.data.id); get.onsuccess = () => { const record = get.result; if (record && record.leaseUntil <= Date.now()) { Object.assign(record, { state: 'pending', attempts: 0, createdAt: Date.now(), nextAttemptAt: 0, failure: null }); store.put(record); } }; });
        await outboxSync().catch(() => {});
      } else throw new Error('unknown outbox operation');
      event.ports[0].postMessage({ result });
    } catch (error) { event.ports[0].postMessage({ error: String(error.message || error) }); }
  })());
});
`
}
