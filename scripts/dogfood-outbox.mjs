import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export async function checkOutbox({ url, app, command, evaluate, wait }) {
  await command('Page.navigate', { url })
  await wait('!!globalThis.__dogfoodOutbox', 'outbox SDK loaded')
  await evaluate('navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready)')
  await wait('!!navigator.serviceWorker.controller', 'worker takes control')
  await command('Network.enable')
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  try {
    const id = await evaluate('globalThis.__dogfoodOutbox.enqueueOffline(location.origin + "/outbox?mode=gated", { method: "POST", body: "persisted-body" })')
    await evaluate('globalThis.__dogfoodOutbox.flushOutbox()')
    assert.equal((await evaluate('globalThis.__dogfoodOutbox.listOutbox()'))[0].id, id)
    await command('ServiceWorker.enable')
    await command('ServiceWorker.stopAllWorkers')
    const restored = await evaluate('globalThis.__dogfoodOutbox.listOutbox()')
    assert.equal(restored[0].id, id, 'worker restart must retain the queued request')
    writeFileSync(join(app, 'outbox-online'), 'online')
    await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await wait('(async () => { await globalThis.__dogfoodOutbox.flushOutbox(); return (await globalThis.__dogfoodOutbox.listOutbox()).length === 0 })()', 'persistent replay acknowledged')
    assert.equal(readFileSync(join(app, `outbox-${id}`), 'utf8'), 'persisted-body')
    const rejected = await evaluate('globalThis.__dogfoodOutbox.enqueueOffline(location.origin + "/outbox?mode=reject", { method: "POST", body: "invalid" })')
    await wait('(async () => { await globalThis.__dogfoodOutbox.flushOutbox(); return (await globalThis.__dogfoodOutbox.listOutbox())[0]?.state === "failed" })()', 'permanent failure retained')
    let record = (await evaluate('globalThis.__dogfoodOutbox.listOutbox()'))[0]
    assert.equal(record.attempts, 1)
    assert.equal(record.failure, 'http-400')
    await evaluate(`globalThis.__dogfoodOutbox.retryOutbox(${JSON.stringify(rejected)})`)
    await evaluate('globalThis.__dogfoodOutbox.flushOutbox()')
    record = (await evaluate('globalThis.__dogfoodOutbox.listOutbox()'))[0]
    assert.equal(record.id, rejected, 'manual retry preserves the idempotency key')
    await evaluate(`globalThis.__dogfoodOutbox.discardOutbox(${JSON.stringify(rejected)})`)
    assert.deepEqual(await evaluate('globalThis.__dogfoodOutbox.listOutbox()'), [])
    const retrying = await evaluate('globalThis.__dogfoodOutbox.enqueueOffline(location.origin + "/outbox?mode=retry", { method: "POST", body: "retry" })')
    await wait('(async () => { await globalThis.__dogfoodOutbox.flushOutbox(); return (await globalThis.__dogfoodOutbox.listOutbox())[0]?.state === "failed" })()', 'retry budget exhausted')
    record = (await evaluate('globalThis.__dogfoodOutbox.listOutbox()'))[0]
    assert.equal(record.attempts, 3)
    await evaluate(`globalThis.__dogfoodOutbox.discardOutbox(${JSON.stringify(retrying)})`)
    assert.equal(await evaluate('globalThis.__dogfoodOutbox.enqueueOffline(location.origin + "/actions", { method:"POST", body:"x" }).then(() => false, () => true)'), true)
    console.log('PASS: IndexedDB outbox restart/replay, body preservation, retries, permanent failures, idempotency keys and explicit discard')
  } finally {
    await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await evaluate('navigator.serviceWorker.getRegistrations().then(all => Promise.all(all.map(registration => registration.unregister())))')
  }
}
