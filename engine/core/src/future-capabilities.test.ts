import assert from 'node:assert/strict'
import { it } from 'node:test'
import { normalizeImages } from './commands/images.js'
import { normalizeOutbox } from './vite/outbox.js'
import { renderServiceWorker } from './vite/service-worker.js'

it('image contracts validate dimensions, sources and encoder quality', () => {
	assert.deepEqual(normalizeImages([{ src: 'photo.jpg', widths: [640, 320, 640] }]), [
		{ src: 'photo.jpg', widths: [320, 640], quality: 80 },
	])
	for (const raw of [
		[{ src: 'x.svg', widths: [1] }],
		[{ src: 'x.png', widths: [] }],
		[{ src: 'x.png', widths: [0] }],
		[{ src: 'x.png', widths: [8193] }],
		[{ src: 'x.jpg', widths: [1], quality: 101 }],
	])
		assert.throws(() => normalizeImages(raw))
})

it('outbox requires explicit paths and bounded persistence/retry policy', () => {
	assert.equal(normalizeOutbox(undefined), null)
	assert.deepEqual(normalizeOutbox({ paths: ['/api/save'] }), {
		paths: ['/api/save'],
		maxAttempts: 5,
		maxAgeMs: 86400000,
	})
	for (const raw of [
		true,
		{ paths: [] },
		{ paths: ['https://other/save'] },
		{ paths: ['/api/../save'] },
		{ paths: ['/x'], maxAttempts: 0 },
		{ paths: ['/x'], maxAgeMs: -1 },
	])
		assert.throws(() => normalizeOutbox(raw))
	const disabled = renderServiceWorker({ version: 'one', precache: [] })
	assert.ok(!disabled.includes('indexedDB'))
	const worker = renderServiceWorker({
		version: 'one',
		precache: [],
		outbox: normalizeOutbox({ paths: ['/api/save'] }),
	})
	assert.doesNotThrow(() => new Function(worker))
	assert.ok(worker.includes('k.startsWith(SW_CACHE_PREFIX)'))
})
